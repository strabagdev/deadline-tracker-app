import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";
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
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
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
        const canForecast = await canViewModule(
          db,
          access.organizationId,
          access.role,
          access.memberTypeId,
          "forecast"
        );
        if (!canForecast) {
          return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
        }
        orgId = access.organizationId;
      }
    }

    const from = offset;
    const to = offset + limit - 1;

    const { data, error } = await db
      .from("deadline_forecasts")
      .select("organization_id, entity_id, deadline_id, forecast_due_date, days_remaining, risk_level, risk_score, computed_at")
      .eq("organization_id", orgId)
      .order("computed_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const forecasts = (data ?? []) as ForecastPowerBiRow[];
    const entityIds = Array.from(new Set(forecasts.map((row) => String(row.entity_id)).filter(Boolean)));
    const deadlineIds = Array.from(new Set(forecasts.map((row) => String(row.deadline_id)).filter(Boolean)));

    const [{ data: entitiesData, error: entitiesErr }, { data: deadlinesData, error: deadlinesErr }] = await Promise.all([
      entityIds.length > 0
        ? db.from("entities").select("id, name").eq("organization_id", orgId).in("id", entityIds)
        : Promise.resolve({ data: [], error: null }),
      deadlineIds.length > 0
        ? db.from("deadlines").select("id, deadline_type_id").eq("organization_id", orgId).in("id", deadlineIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (entitiesErr) throw entitiesErr;
    if (deadlinesErr) throw deadlinesErr;

    const deadlineTypeIds = Array.from(
      new Set(
        ((deadlinesData ?? []) as Array<{ deadline_type_id: string | null }>)
          .map((row) => String(row.deadline_type_id ?? "").trim())
          .filter((value) => value.length > 0)
      )
    );
    const { data: deadlineTypesData, error: deadlineTypesErr } = deadlineTypeIds.length
      ? await db
          .from("deadline_types")
          .select("id, name, measure_by")
          .eq("organization_id", orgId)
          .in("id", deadlineTypeIds)
      : { data: [], error: null };
    if (deadlineTypesErr) throw deadlineTypesErr;

    const entityById = new Map(((entitiesData ?? []) as Array<{ id: string; name: string | null }>).map((row) => [String(row.id), row]));
    const deadlineById = new Map(
      ((deadlinesData ?? []) as Array<{ id: string; deadline_type_id: string | null }>).map((row) => [String(row.id), row])
    );
    const deadlineTypeById = new Map(
      ((deadlineTypesData ?? []) as Array<{ id: string; name: string | null; measure_by: "date" | "usage" | null }>).map((row) => [String(row.id), row])
    );

    const rows = forecasts.map((r) => {
      const entity = entityById.get(String(r.entity_id));
      const deadline = deadlineById.get(String(r.deadline_id));
      const deadlineType = deadline?.deadline_type_id ? deadlineTypeById.get(String(deadline.deadline_type_id)) : null;
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
