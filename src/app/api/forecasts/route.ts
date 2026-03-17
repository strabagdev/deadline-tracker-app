import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";

type RiskLevel = "green" | "yellow" | "orange" | "red" | "none";

type ForecastRowRaw = {
  entity_id: string;
  deadline_id: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: RiskLevel;
  risk_score: number;
  computed_at: string;
};

type EntityRow = {
  id: string;
  name: string | null;
  entity_type_id: string | null;
};

type EntityTypeRow = {
  id: string;
  name: string | null;
};

type DeadlineRow = {
  id: string;
  is_current: boolean | null;
  deadline_type_id: string | null;
};

type DeadlineTypeRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
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
    const canForecast = await canViewModule(db, orgId, access.role, access.memberTypeId, "forecast");
    if (!canForecast) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const { data, error } = await db
      .from("deadline_forecasts")
      .select("entity_id, deadline_id, forecast_due_date, days_remaining, risk_level, risk_score, computed_at")
      .eq("organization_id", orgId)
      .order("computed_at", { ascending: false });

    if (error) throw error;
    const rowsRaw = (data ?? []) as ForecastRowRaw[];

    const entityIds = Array.from(new Set(rowsRaw.map((row) => row.entity_id).filter(Boolean)));
    const deadlineIds = Array.from(new Set(rowsRaw.map((row) => row.deadline_id).filter(Boolean)));

    const [{ data: entitiesData, error: entitiesErr }, { data: deadlinesData, error: deadlinesErr }] = await Promise.all([
      entityIds.length > 0
        ? db.from("entities").select("id, name, entity_type_id").eq("organization_id", orgId).in("id", entityIds)
        : Promise.resolve({ data: [], error: null }),
      deadlineIds.length > 0
        ? db.from("deadlines").select("id, is_current, deadline_type_id").eq("organization_id", orgId).in("id", deadlineIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (entitiesErr) throw entitiesErr;
    if (deadlinesErr) throw deadlinesErr;

    const entities = (entitiesData ?? []) as EntityRow[];
    const deadlines = (deadlinesData ?? []) as DeadlineRow[];
    const entityTypeIds = Array.from(new Set(entities.map((entity) => entity.entity_type_id).filter(Boolean))) as string[];
    const deadlineTypeIds = Array.from(new Set(deadlines.map((deadline) => deadline.deadline_type_id).filter(Boolean))) as string[];

    const [{ data: entityTypesData, error: entityTypesErr }, { data: deadlineTypesData, error: deadlineTypesErr }] = await Promise.all([
      entityTypeIds.length > 0
        ? db.from("entity_types").select("id, name").eq("organization_id", orgId).in("id", entityTypeIds)
        : Promise.resolve({ data: [], error: null }),
      deadlineTypeIds.length > 0
        ? db.from("deadline_types").select("id, name, is_active").eq("organization_id", orgId).in("id", deadlineTypeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (entityTypesErr) throw entityTypesErr;
    if (deadlineTypesErr) throw deadlineTypesErr;

    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const deadlineById = new Map(deadlines.map((deadline) => [deadline.id, deadline]));
    const entityTypeById = new Map(((entityTypesData ?? []) as EntityTypeRow[]).map((type) => [type.id, type]));
    const deadlineTypeById = new Map(((deadlineTypesData ?? []) as DeadlineTypeRow[]).map((type) => [type.id, type]));

    const rows = rowsRaw
      .map((row) => {
        const entity = entityById.get(row.entity_id);
        const deadline = deadlineById.get(row.deadline_id);
        if (!deadline?.is_current) return null;
        const deadlineType = deadline.deadline_type_id ? deadlineTypeById.get(deadline.deadline_type_id) : null;
        if (deadlineType?.is_active === false) return null;
        const entityType = entity?.entity_type_id ? entityTypeById.get(entity.entity_type_id) : null;
        return {
          entity_id: row.entity_id,
          entity_name: entity?.name ?? "Entidad",
          entity_type_id: entity?.entity_type_id ?? null,
          entity_type_name: entityType?.name ?? "Sin tipo",
          deadline_id: row.deadline_id,
          deadline_name: deadlineType?.name ?? "Vencimiento",
          forecast_due_date: row.forecast_due_date,
          days_remaining: row.days_remaining,
          risk_level: row.risk_level,
          risk_score: Number(row.risk_score ?? 0),
          computed_at: row.computed_at,
        };
      })
      .filter(
        (row): row is {
          entity_id: string;
          entity_name: string;
          entity_type_id: string | null;
          entity_type_name: string;
          deadline_id: string;
          deadline_name: string;
          forecast_due_date: string | null;
          days_remaining: number | null;
          risk_level: RiskLevel;
          risk_score: number;
          computed_at: string;
        } => Boolean(row)
      );

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

    const dueIn7 = rows.filter((row) => row.days_remaining != null && row.days_remaining <= 7).length;
    const dueIn30 = rows.filter((row) => row.days_remaining != null && row.days_remaining <= 30).length;
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
