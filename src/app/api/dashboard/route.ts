import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";

type DataClient = ReturnType<typeof createDataServerClient>;

type EntityRow = {
  id: string;
  name: string;
  created_at: string;
  entity_type_id: string | null;
  tracks_usage: boolean;
  usage_unit_id: string | null;
  entity_types?: { id: string; name: string } | { id: string; name: string }[] | null;
};

type ForecastRow = {
  entity_id: string;
  deadline_id: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: "green" | "yellow" | "orange" | "red" | "none";
  risk_score: number | null;
  deadlines?:
    | { deadline_types?: { name: string | null; measure_by: "date" | "usage" | null } | { name: string | null; measure_by: "date" | "usage" | null }[] | null }
    | { deadline_types?: { name: string | null; measure_by: "date" | "usage" | null } | { name: string | null; measure_by: "date" | "usage" | null }[] | null }[]
    | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function getLatestUsageByEntity(db: DataClient, orgId: string, entityIds: string[]) {
  const out: Record<string, { value: number; logged_at: string; logged_on: string | null }> = {};
  if (entityIds.length === 0) return out;

  const { data, error } = await db
    .from("usage_logs")
    .select("entity_id, value, logged_on, logged_at")
    .eq("organization_id", orgId)
    .in("entity_id", entityIds)
    .not("value", "is", null)
    .order("entity_id", { ascending: true })
    .order("logged_on", { ascending: false })
    .order("logged_at", { ascending: false })
    .limit(100000);

  if (error) throw error;

  for (const row of (data ?? []) as Array<{ entity_id: string; value: number; logged_on: string | null; logged_at: string }>) {
    if (!out[row.entity_id]) {
      out[row.entity_id] = {
        value: Number(row.value),
        logged_on: row.logged_on ? String(row.logged_on) : null,
        logged_at: String(row.logged_at),
      };
    }
  }

  return out;
}

async function getCardFieldsByEntity(db: DataClient, orgId: string, entityIds: string[]) {
  const out: Record<string, Array<{ name: string; value_text: string }>> = {};
  if (entityIds.length === 0) return out;

  const { data: values, error: valuesError } = await db
    .from("entity_field_values")
    .select("entity_id, entity_field_id, value_text")
    .eq("organization_id", orgId)
    .in("entity_id", entityIds);
  if (valuesError) throw valuesError;

  const fieldIds = Array.from(
    new Set(
      ((values ?? []) as Array<{ entity_field_id: string | null }>)
        .map((v) => v.entity_field_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (fieldIds.length === 0) return out;

  const { data: fields, error: fieldsError } = await db
    .from("entity_fields")
    .select("id, name, show_in_card, created_at")
    .eq("organization_id", orgId)
    .in("id", fieldIds);
  if (fieldsError) throw fieldsError;

  const fieldMap = new Map<string, { name: string; show_in_card: boolean; created_at: string | null }>();
  for (const field of (fields ?? []) as Array<{ id: string; name: string; show_in_card: boolean; created_at: string | null }>) {
    fieldMap.set(field.id, {
      name: String(field.name ?? ""),
      show_in_card: Boolean(field.show_in_card),
      created_at: field.created_at ?? null,
    });
  }

  for (const row of (values ?? []) as Array<{ entity_id: string; entity_field_id: string | null; value_text: string | null }>) {
    if (!row.entity_field_id) continue;
    const field = fieldMap.get(row.entity_field_id);
    if (!field || !field.show_in_card) continue;

    const valueText = String(row.value_text ?? "").trim();
    if (!valueText) continue;

    if (!out[row.entity_id]) out[row.entity_id] = [];
    out[row.entity_id].push({ name: field.name, value_text: valueText });
  }

  return out;
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

    const { data: entitiesData, error: entitiesErr } = await db
      .from("entities")
      .select("id, name, created_at, entity_type_id, tracks_usage, usage_unit_id, entity_types(id, name)")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (entitiesErr) throw entitiesErr;

    const entities = (entitiesData ?? []) as EntityRow[];
    const entityIds = entities.map((e) => e.id);

    const [latestUsageByEntity, cardFieldsByEntity] = await Promise.all([
      getLatestUsageByEntity(db, orgId, entityIds),
      getCardFieldsByEntity(db, orgId, entityIds),
    ]);

    const nearestForecastByEntity = new Map<
      string,
      {
        deadline_id: string;
        deadline_name: string;
        measure_by: "date" | "usage" | "unknown";
        forecast_due_date: string | null;
        days_remaining: number | null;
        risk_level: "green" | "yellow" | "orange" | "red" | "none";
        risk_score: number;
      }
    >();

    if (entityIds.length > 0) {
      const { data: forecastsData, error: forecastsErr } = await db
        .from("deadline_forecasts")
        .select(
          "entity_id, deadline_id, forecast_due_date, days_remaining, risk_level, risk_score, deadlines(deadline_types(name, measure_by))"
        )
        .eq("organization_id", orgId)
        .in("entity_id", entityIds);
      if (forecastsErr) throw forecastsErr;

      for (const row of (forecastsData ?? []) as ForecastRow[]) {
        const current = nearestForecastByEntity.get(row.entity_id);
        const rowDays = row.days_remaining ?? Number.MAX_SAFE_INTEGER;
        const currentDays = current?.days_remaining ?? Number.MAX_SAFE_INTEGER;
        if (!current || rowDays < currentDays) {
          const deadline = pickOne(row.deadlines);
          const deadlineType = pickOne(deadline?.deadline_types ?? null);
          nearestForecastByEntity.set(row.entity_id, {
            deadline_id: String(row.deadline_id),
            deadline_name: String(deadlineType?.name ?? "Vencimiento"),
            measure_by:
              deadlineType?.measure_by === "date" || deadlineType?.measure_by === "usage"
                ? deadlineType.measure_by
                : "unknown",
            forecast_due_date: row.forecast_due_date ? String(row.forecast_due_date) : null,
            days_remaining: row.days_remaining != null ? Number(row.days_remaining) : null,
            risk_level: row.risk_level,
            risk_score: Number(row.risk_score ?? 0),
          });
        }
      }
    }

    const resultEntities = entities.map((e) => ({
      id: e.id,
      name: e.name,
      created_at: e.created_at,
      entity_type_id: e.entity_type_id,
      tracks_usage: Boolean(e.tracks_usage),
      usage_unit_id: e.usage_unit_id,
      entity_types: pickOne(e.entity_types),
      card_fields: cardFieldsByEntity[e.id] ?? [],
      nearest_forecast: nearestForecastByEntity.get(e.id) ?? null,
    }));

    return NextResponse.json({
      meta: { active_org_id: orgId, role: access.role, entity_count_in_org: entities.length },
      entities: resultEntities,
      latest_usage_by_entity: latestUsageByEntity,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
