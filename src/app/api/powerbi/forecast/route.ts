import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";
import { isSuperAdmin } from "@/lib/server/superAdmin";

type ForecastPowerBiRow = {
  organization_id: string;
  entity_id: string;
  deadline_id: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: string;
  risk_score: number | null;
  computed_at: string;
  entities?: { name: string | null } | { name: string | null }[] | null;
  deadlines?:
    | {
        deadline_types?: { name: string | null; measure_by?: "date" | "usage" | null } | { name: string | null; measure_by?: "date" | "usage" | null }[] | null;
      }
    | {
        deadline_types?: { name: string | null; measure_by?: "date" | "usage" | null } | { name: string | null; measure_by?: "date" | "usage" | null }[] | null;
      }[]
    | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function unauthorized(message: string) {
  return NextResponse.json({ error: message, code: "UNAUTHORIZED" }, { status: 401 });
}

export async function GET(req: Request) {
  try {
    const db = createDataServerClient();
    const url = new URL(req.url);

    const limit = parsePositiveInt(url.searchParams.get("limit"), 5000, 10000);
    const offsetRaw = Number(url.searchParams.get("offset") ?? 0);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;

    const requestedOrgId = (url.searchParams.get("org_id") ?? "").trim();
    const pbiKey = (url.searchParams.get("pbi_key") ?? "").trim();
    const configuredPbiKey = (process.env.POWERBI_EXPORT_KEY ?? "").trim();

    let orgId = "";
    const authHeader = req.headers.get("authorization") || "";
    const hasBearer = authHeader.startsWith("Bearer ");

    if (!hasBearer) {
      // Modo integración Power BI por URL única (sin header Authorization).
      if (!configuredPbiKey) return unauthorized("POWERBI_EXPORT_KEY is not configured");
      if (!pbiKey || pbiKey !== configuredPbiKey) return unauthorized("invalid pbi_key");
      if (!requestedOrgId) {
        return NextResponse.json(
          { error: "org_id required", code: "BAD_REQUEST" },
          { status: 400 }
        );
      }
      orgId = requestedOrgId;
    } else {
      const { user } = await requireAuthUser(req);
      const superAdmin = await isSuperAdmin(db, user.id);
      if (superAdmin) {
        if (!requestedOrgId) {
          return NextResponse.json(
            { error: "org_id required for super admin", code: "BAD_REQUEST" },
            { status: 400 }
          );
        }
        orgId = requestedOrgId;
      } else {
        const access = await getOrgAccess(db, user.id);
        if ("error" in access) {
          return NextResponse.json(
            { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
            { status: access.error === "no active organization" ? 400 : 403 }
          );
        }
        orgId = access.organizationId;
      }
    }

    const from = offset;
    const to = offset + limit - 1;

    const { data, error } = await db
      .from("deadline_forecasts")
      .select(
        `
        organization_id,
        entity_id,
        deadline_id,
        forecast_due_date,
        days_remaining,
        risk_level,
        risk_score,
        computed_at,
        entities(name),
        deadlines(deadline_types(name, measure_by))
      `
      )
      .eq("organization_id", orgId)
      .order("computed_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = ((data ?? []) as ForecastPowerBiRow[]).map((r) => {
      const entity = pickOne(r.entities);
      const deadline = pickOne(r.deadlines);
      const deadlineType = pickOne(deadline?.deadline_types ?? null);
      return {
        organization_id: r.organization_id,
        entity_id: r.entity_id,
        entity_name: entity?.name ?? null,
        deadline_id: r.deadline_id,
        deadline_name: deadlineType?.name ?? null,
        deadline_measure_by: deadlineType?.measure_by ?? null,
        forecast_due_date: r.forecast_due_date,
        days_remaining: r.days_remaining,
        risk_level: r.risk_level,
        risk_score: r.risk_score != null ? Number(r.risk_score) : null,
        computed_at: r.computed_at,
      };
    });

    return NextResponse.json({
      meta: {
        organization_id: orgId,
        limit,
        offset,
        returned_rows: rows.length,
      },
      rows,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
