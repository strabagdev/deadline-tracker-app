import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";

type RiskLevel = "green" | "yellow" | "orange" | "red" | "none";

type ForecastRow = {
  entity_id: string;
  deadline_id: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: RiskLevel;
  risk_score: number;
  computed_at: string;
};

type DeadlineRow = {
  id: string;
  entity_id: string;
  deadline_type_id: string | null;
  measure_by: "date" | "usage" | null;
  last_done_date: string | null;
  next_due_date: string | null;
  frequency: number | null;
  usage_daily_average: number | null;
  created_at: string;
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

type DeadlineTypeRow = {
  id: string;
  name: string | null;
  measure_by: "date" | "usage";
  is_active: boolean | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function parseDateOnly(raw: string | null): Date | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function dateIso(date: Date | null) {
  return date ? date.toISOString() : null;
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

    const url = new URL(req.url);
    const entityIdFilter = String(url.searchParams.get("entity_id") ?? "").trim();
    const entityTypeIdFilter = String(url.searchParams.get("entity_type_id") ?? "").trim();
    const deadlineTypeIdFilter = String(url.searchParams.get("deadline_type_id") ?? "").trim();

    const { data: forecastsData, error: forecastsErr } = await db
      .from("deadline_forecasts")
      .select("entity_id, deadline_id, forecast_due_date, days_remaining, risk_level, risk_score, computed_at")
      .eq("organization_id", orgId);
    if (forecastsErr) throw forecastsErr;

    const { data: deadlinesData, error: deadlinesErr } = await db
      .from("deadlines")
      .select("id, entity_id, deadline_type_id, measure_by, last_done_date, next_due_date, frequency, usage_daily_average, created_at")
      .eq("organization_id", orgId)
      .eq("is_current", true);
    if (deadlinesErr) throw deadlinesErr;

    const forecasts = (forecastsData ?? []) as ForecastRow[];
    const deadlines = (deadlinesData ?? []) as DeadlineRow[];
    const deadlineById = new Map(deadlines.map((deadline) => [deadline.id, deadline]));

    const entityIds = Array.from(new Set(deadlines.map((deadline) => deadline.entity_id).filter(Boolean)));
    const entityTypeIdsFromDeadlineScan = new Set<string>();
    const deadlineTypeIds = Array.from(new Set(deadlines.map((deadline) => deadline.deadline_type_id).filter(Boolean))) as string[];

    const [{ data: entitiesData, error: entitiesErr }, { data: deadlineTypesData, error: deadlineTypesErr }] = await Promise.all([
      entityIds.length > 0
        ? db.from("entities").select("id, name, entity_type_id").eq("organization_id", orgId).in("id", entityIds)
        : Promise.resolve({ data: [], error: null }),
      deadlineTypeIds.length > 0
        ? db.from("deadline_types").select("id, name, measure_by, is_active").eq("organization_id", orgId).in("id", deadlineTypeIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (entitiesErr) throw entitiesErr;
    if (deadlineTypesErr) throw deadlineTypesErr;

    const entities = (entitiesData ?? []) as EntityRow[];
    for (const entity of entities) {
      if (entity.entity_type_id) entityTypeIdsFromDeadlineScan.add(entity.entity_type_id);
    }

    const entityTypeIds = Array.from(entityTypeIdsFromDeadlineScan);
    const { data: entityTypesData, error: entityTypesErr } =
      entityTypeIds.length > 0
        ? await db.from("entity_types").select("id, name").eq("organization_id", orgId).in("id", entityTypeIds)
        : { data: [], error: null };
    if (entityTypesErr) throw entityTypesErr;

    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const entityTypeById = new Map(((entityTypesData ?? []) as EntityTypeRow[]).map((type) => [type.id, type]));
    const deadlineTypeById = new Map(((deadlineTypesData ?? []) as DeadlineTypeRow[]).map((type) => [type.id, type]));
    const forecastByDeadlineId = new Map(forecasts.map((forecast) => [forecast.deadline_id, forecast]));

    const rows = deadlines
      .map((deadline) => {
        const entity = entityById.get(deadline.entity_id);
        const entityType = entity?.entity_type_id ? entityTypeById.get(entity.entity_type_id) : null;
        const deadlineType = deadline.deadline_type_id ? deadlineTypeById.get(deadline.deadline_type_id) : null;
        const forecast = forecastByDeadlineId.get(deadline.id);
        if (deadlineType?.is_active === false) return null;
        if (entityIdFilter && deadline.entity_id !== entityIdFilter) return null;
        if (entityTypeIdFilter && entity?.entity_type_id !== entityTypeIdFilter) return null;
        if (deadlineTypeIdFilter && deadline.deadline_type_id !== deadlineTypeIdFilter) return null;

        const measureBy = (deadlineType?.measure_by ?? deadline.measure_by ?? "date") as "date" | "usage";
        const endDate =
          measureBy === "date"
            ? parseDateOnly(deadline.next_due_date) ?? parseDateOnly(forecast?.forecast_due_date ?? null)
            : parseDateOnly(forecast?.forecast_due_date ?? null);

        let startDate =
          parseDateOnly(deadline.last_done_date) ??
          (measureBy === "date" ? parseDateOnly(deadline.created_at) : null);

        if (!startDate && measureBy === "usage" && endDate && deadline.frequency != null && deadline.usage_daily_average != null) {
          const avg = Number(deadline.usage_daily_average);
          const frequency = Number(deadline.frequency);
          if (Number.isFinite(avg) && avg > 0 && Number.isFinite(frequency) && frequency > 0) {
            startDate = addDays(endDate, -Math.ceil(frequency / avg));
          }
        }

        if (!startDate && endDate) {
          startDate = addDays(endDate, -30);
        }
        if (!startDate || !endDate) return null;

        return {
          entity_id: deadline.entity_id,
          entity_name: entity?.name ?? "Entidad",
          entity_type_id: entity?.entity_type_id ?? null,
          entity_type_name: entityType?.name ?? "Sin tipo",
          deadline_id: deadline.id,
          deadline_type_id: deadline.deadline_type_id,
          deadline_type_name: deadlineType?.name ?? "Vencimiento",
          measure_by: measureBy,
          start_date: dateIso(startDate),
          end_date: dateIso(endDate),
          forecast_due_date: forecast?.forecast_due_date ?? dateIso(endDate),
          last_done_date: deadline.last_done_date,
          next_due_date: deadline.next_due_date,
          days_remaining: forecast?.days_remaining ?? null,
          risk_level: forecast?.risk_level ?? "none",
          risk_score: forecast?.risk_score ?? 0,
          computed_at: forecast?.computed_at ?? deadline.created_at,
        };
      })
      .filter(
        (row): row is {
          entity_id: string;
          entity_name: string;
          entity_type_id: string | null;
          entity_type_name: string;
          deadline_id: string;
          deadline_type_id: string | null;
          deadline_type_name: string;
          measure_by: "date" | "usage";
          start_date: string;
          end_date: string;
          forecast_due_date: string | null;
          last_done_date: string | null;
          next_due_date: string | null;
          days_remaining: number | null;
          risk_level: RiskLevel;
          risk_score: number;
          computed_at: string;
        } => Boolean(row)
      )
      .sort((a, b) => {
        const byEntity = a.entity_name.localeCompare(b.entity_name, "es", { sensitivity: "base" });
        if (byEntity !== 0) return byEntity;
        return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
      });

    return NextResponse.json({
      rows,
      options: {
        entities: entities
          .map((entity) => ({ id: entity.id, name: entity.name ?? "Entidad" }))
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
        entity_types: ((entityTypesData ?? []) as EntityTypeRow[])
          .map((type) => ({ id: type.id, name: type.name ?? "Sin tipo" }))
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
        deadline_types: ((deadlineTypesData ?? []) as DeadlineTypeRow[])
          .filter((type) => type.is_active !== false)
          .map((type) => ({ id: type.id, name: type.name ?? "Vencimiento" }))
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
