import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";

type DataClient = ReturnType<typeof createDataServerClient>;
type Status = "green" | "yellow" | "orange" | "red" | "none";

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

function statusPriority(s: Status) {
  if (s === "red") return 0;
  if (s === "orange") return 1;
  if (s === "yellow") return 2;
  if (s === "green") return 3;
  return 4;
}

function riskFromDays(daysRemaining: number, thresholds: { yellow: number; orange: number; red: number }): Status {
  if (daysRemaining <= thresholds.red) return "red";
  if (daysRemaining <= thresholds.orange) return "orange";
  if (daysRemaining <= thresholds.yellow) return "yellow";
  return "green";
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

  const values: Array<{ entity_id: string; entity_field_id: string | null; value_text: string | null }> = [];
  const idChunkSize = 200;
  const pageSize = 1000;

  for (let i = 0; i < entityIds.length; i += idChunkSize) {
    const idChunk = entityIds.slice(i, i + idChunkSize);
    let from = 0;
    for (;;) {
      const to = from + pageSize - 1;
      const { data, error } = await db
        .from("entity_field_values")
        .select("entity_id, entity_field_id, value_text")
        .eq("organization_id", orgId)
        .in("entity_id", idChunk)
        .order("entity_id", { ascending: true })
        .order("entity_field_id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ entity_id: string; entity_field_id: string | null; value_text: string | null }>;
      values.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  const fieldIds = Array.from(
    new Set(
      values.map((v) => v.entity_field_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  if (fieldIds.length === 0) return out;

  const fields: Array<{ id: string; name: string; show_in_card: boolean; created_at: string | null }> = [];
  for (let i = 0; i < fieldIds.length; i += idChunkSize) {
    const fieldChunk = fieldIds.slice(i, i + idChunkSize);
    const { data, error } = await db
      .from("entity_fields")
      .select("id, name, show_in_card, created_at")
      .eq("organization_id", orgId)
      .in("id", fieldChunk);
    if (error) throw error;
    fields.push(...((data ?? []) as Array<{ id: string; name: string; show_in_card: boolean; created_at: string | null }>));
  }

  const fieldMap = new Map<string, { name: string; show_in_card: boolean; created_at: string | null }>();
  for (const field of fields) {
    fieldMap.set(field.id, {
      name: String(field.name ?? ""),
      show_in_card: Boolean(field.show_in_card),
      created_at: field.created_at ?? null,
    });
  }

  for (const row of values) {
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
    const url = new URL(req.url);
    const mode = String(url.searchParams.get("mode") ?? "analytics").toLowerCase();
    const statusRaw = String(url.searchParams.get("status") ?? "").trim();
    const statuses = Array.from(
      new Set(
        statusRaw
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s): s is Status => ["red", "orange", "yellow", "green", "none"].includes(s))
      )
    );
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
    const pageSizeRaw = url.searchParams.get("page_size");
    const pageSizeParsed = pageSizeRaw == null ? 0 : Number(pageSizeRaw);
    const pageSize =
      Number.isFinite(pageSizeParsed) && pageSizeParsed > 0
        ? Math.min(200, Math.trunc(pageSizeParsed))
        : 0;

    const [canAnalytics, canOperations, canEntities] = await Promise.all([
      canViewModule(db, orgId, access.role, access.memberTypeId, "analytics_dashboard"),
      canViewModule(db, orgId, access.role, access.memberTypeId, "operations_dashboard"),
      canViewModule(db, orgId, access.role, access.memberTypeId, "entities"),
    ]);

    const allowedByMode =
      mode === "operations"
        ? canOperations || canEntities
        : canAnalytics || canEntities;
    if (!allowedByMode) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

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
    const fallbackNearestByEntity = new Map<
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

      const { data: settingsData, error: settingsErr } = await db
        .from("organization_settings")
        .select("yellow_days, orange_days, red_days")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (settingsErr) throw settingsErr;
      const thresholds = {
        yellow: Number(settingsData?.yellow_days ?? 60),
        orange: Number(settingsData?.orange_days ?? 30),
        red: Number(settingsData?.red_days ?? 15),
      };

      const { data: deadlinesData, error: deadlinesErr } = await db
        .from("deadlines")
        .select("id, entity_id, next_due_date, deadline_types(name, measure_by)")
        .eq("organization_id", orgId)
        .in("entity_id", entityIds)
        .not("next_due_date", "is", null);
      if (deadlinesErr) throw deadlinesErr;

      const todayIso = new Date().toISOString().slice(0, 10);
      const todayTs = Date.parse(`${todayIso}T00:00:00Z`);
      for (const row of (deadlinesData ?? []) as Array<{
        id: string;
        entity_id: string;
        next_due_date: string | null;
        deadline_types?: { name?: string | null; measure_by?: "date" | "usage" | null } | { name?: string | null; measure_by?: "date" | "usage" | null }[] | null;
      }>) {
        if (nearestForecastByEntity.has(row.entity_id)) continue;
        if (!row.next_due_date) continue;
        const dt = pickOne(row.deadline_types ?? null);
        if (dt?.measure_by !== "date") continue;

        const dueTs = Date.parse(`${String(row.next_due_date).slice(0, 10)}T00:00:00Z`);
        if (Number.isNaN(dueTs)) continue;
        const daysRemaining = Math.ceil((dueTs - todayTs) / (24 * 60 * 60 * 1000));
        const risk = riskFromDays(daysRemaining, thresholds);
        const riskScore = risk === "red" ? 100 : risk === "orange" ? 75 : risk === "yellow" ? 50 : 25;

        const current = fallbackNearestByEntity.get(row.entity_id);
        const currentDays = current?.days_remaining ?? Number.MAX_SAFE_INTEGER;
        if (!current || daysRemaining < currentDays) {
          fallbackNearestByEntity.set(row.entity_id, {
            deadline_id: String(row.id),
            deadline_name: String(dt?.name ?? "Vencimiento"),
            measure_by: "date",
            forecast_due_date: String(row.next_due_date),
            days_remaining: daysRemaining,
            risk_level: risk,
            risk_score: riskScore,
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
      nearest_forecast: nearestForecastByEntity.get(e.id) ?? fallbackNearestByEntity.get(e.id) ?? null,
    }));

    const latestUsageOut: Record<string, { value: number; logged_at: string; logged_on: string | null }> = latestUsageByEntity;
    let entitiesOut = resultEntities;
    let filteredCount = resultEntities.length;

    if (mode === "operations") {
      let filtered = resultEntities;
      if (statuses.length > 0) {
        filtered = filtered.filter((e) => statuses.includes((e.nearest_forecast?.risk_level ?? "none") as Status));
      }
      filtered.sort((a, b) => {
        const sa = (a.nearest_forecast?.risk_level ?? "none") as Status;
        const sb = (b.nearest_forecast?.risk_level ?? "none") as Status;
        const pa = statusPriority(sa);
        const pb = statusPriority(sb);
        if (pa !== pb) return pa - pb;
        const da = a.nearest_forecast?.forecast_due_date ? new Date(a.nearest_forecast.forecast_due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.nearest_forecast?.forecast_due_date ? new Date(b.nearest_forecast.forecast_due_date).getTime() : Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      });

      filteredCount = filtered.length;
      if (pageSize > 0) {
        const from = (page - 1) * pageSize;
        const to = from + pageSize;
        filtered = filtered.slice(from, to);
      }
      entitiesOut = filtered;
    }

    const latestUsageFiltered = mode === "operations"
      ? Object.fromEntries(
          Object.entries(latestUsageOut).filter(([entityId]) => entitiesOut.some((e) => e.id === entityId))
        )
      : latestUsageOut;

    return NextResponse.json({
      meta: {
        active_org_id: orgId,
        role: access.role,
        entity_count_in_org: entities.length,
        filtered_count: filteredCount,
        page: pageSize > 0 ? page : 1,
        page_size: pageSize > 0 ? pageSize : null,
      },
      entities: entitiesOut,
      latest_usage_by_entity: latestUsageFiltered,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
