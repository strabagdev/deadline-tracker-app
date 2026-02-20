import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";

type ForecastRowRaw = {
  entity_id: string;
  deadline_id: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: "green" | "yellow" | "orange" | "red" | "none";
  risk_score: number;
  computed_at: string;
  entities?: { name: string | null } | { name: string | null }[] | null;
  deadlines?:
    | { deadline_types?: { name: string | null } | { name: string | null }[] | null }
    | { deadline_types?: { name: string | null } | { name: string | null }[] | null }[]
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

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }

    const orgId = access.organizationId;
    const { data, error } = await db
      .from("deadline_forecasts")
      .select(
        `
        entity_id,
        deadline_id,
        forecast_due_date,
        days_remaining,
        risk_level,
        risk_score,
        computed_at,
        entities(name),
        deadlines(deadline_types(name))
      `
      )
      .eq("organization_id", orgId)
      .order("computed_at", { ascending: false });

    if (error) throw error;
    const rowsRaw = (data ?? []) as ForecastRowRaw[];

    const rows = rowsRaw.map((r) => {
      const entity = pickOne(r.entities);
      const deadline = pickOne(r.deadlines);
      const deadlineType = pickOne(deadline?.deadline_types ?? null);
      return {
        entity_id: r.entity_id,
        entity_name: entity?.name ?? "Entidad",
        deadline_id: r.deadline_id,
        deadline_name: deadlineType?.name ?? "Vencimiento",
        forecast_due_date: r.forecast_due_date,
        days_remaining: r.days_remaining,
        risk_level: r.risk_level,
        risk_score: Number(r.risk_score ?? 0),
        computed_at: r.computed_at,
      };
    });

    const nearestByEntity = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const current = nearestByEntity.get(row.entity_id);
      const rowDays = row.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const currentDays = current?.days_remaining ?? Number.MAX_SAFE_INTEGER;
      if (!current || rowDays < currentDays) {
        nearestByEntity.set(row.entity_id, row);
      }
    }

    const entitiesView = Array.from(nearestByEntity.values()).sort((a, b) => {
      const da = a.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const db = b.days_remaining ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    const dueIn7 = rows.filter((r) => r.days_remaining != null && r.days_remaining <= 7).length;
    const dueIn30 = rows.filter((r) => r.days_remaining != null && r.days_remaining <= 30).length;
    const computedAt = rows.length > 0 ? rows[0].computed_at : null;

    return NextResponse.json({
      summary: {
        upcoming_7_days: dueIn7,
        upcoming_30_days: dueIn30,
        total_forecasts: rows.length,
        total_entities: entitiesView.length,
      },
      entities: entitiesView,
      computed_at: computedAt,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
