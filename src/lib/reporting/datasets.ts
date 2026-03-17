import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataClient = ReturnType<typeof createDataServerClient>;

export const BI_DATASETS = [
  { key: "forecast", label: "Forecast de vencimientos" },
  { key: "deadlines_current", label: "Vencimientos vigentes" },
  { key: "usage_logs", label: "Registros de uso" },
  { key: "usage_logs_flat", label: "Registros de uso (plano BI)" },
] as const;

export type BiDatasetKey = (typeof BI_DATASETS)[number]["key"];

type ForecastRow = {
  organization_id: string;
  entity_id: string;
  deadline_id: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: string;
  risk_score: number | null;
  computed_at: string;
};

type DeadlineRow = {
  id: string;
  organization_id: string;
  entity_id: string;
  deadline_type_id: string;
  measure_by: string | null;
  next_due_date: string | null;
  last_done_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  created_at: string;
};

type UsageLogRow = {
  id: string;
  organization_id: string;
  entity_id: string;
  value: number | null;
  value_text: string | null;
  logged_on: string;
  logged_at: string;
};

type EntityRow = {
  id: string;
  name: string | null;
  entity_type_id?: string | null;
  usage_unit_id?: string | null;
};

type EntityTypeRow = {
  id: string;
  name: string | null;
};

type UsageUnitRow = {
  id: string;
  name: string | null;
};

type DeadlineTypeRow = {
  id: string;
  name: string | null;
  measure_by?: "date" | "usage" | null;
};

type UsageFieldDefRow = {
  id: string;
  name: string | null;
  key: string | null;
};

type EntityFieldDefRow = {
  id: string;
  name: string | null;
  key: string | null;
};

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function readMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return "error";
}

export function isBiDatasetKey(value: string): value is BiDatasetKey {
  return BI_DATASETS.some((d) => d.key === value);
}

function sanitizeColumnKey(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function loadEntitiesById(db: DataClient, organizationId: string, entityIds: string[]) {
  if (entityIds.length === 0) return new Map<string, EntityRow>();
  const { data, error } = await db
    .from("entities")
    .select("id, name, entity_type_id, usage_unit_id")
    .eq("organization_id", organizationId)
    .in("id", entityIds);
  if (error) throw new Error(readMessage(error));
  return new Map(((data ?? []) as EntityRow[]).map((row) => [String(row.id), row]));
}

async function loadEntityTypesById(db: DataClient, organizationId: string, entityTypeIds: string[]) {
  if (entityTypeIds.length === 0) return new Map<string, EntityTypeRow>();
  const { data, error } = await db
    .from("entity_types")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", entityTypeIds);
  if (error) throw new Error(readMessage(error));
  return new Map(((data ?? []) as EntityTypeRow[]).map((row) => [String(row.id), row]));
}

async function loadUsageUnitsById(db: DataClient, organizationId: string, usageUnitIds: string[]) {
  if (usageUnitIds.length === 0) return new Map<string, UsageUnitRow>();
  const { data, error } = await db
    .from("usage_units")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", usageUnitIds);
  if (error) throw new Error(readMessage(error));
  return new Map(((data ?? []) as UsageUnitRow[]).map((row) => [String(row.id), row]));
}

async function loadDeadlineTypesById(db: DataClient, organizationId: string, deadlineTypeIds: string[]) {
  if (deadlineTypeIds.length === 0) return new Map<string, DeadlineTypeRow>();
  const { data, error } = await db
    .from("deadline_types")
    .select("id, name, measure_by")
    .eq("organization_id", organizationId)
    .in("id", deadlineTypeIds);
  if (error) throw new Error(readMessage(error));
  return new Map(((data ?? []) as DeadlineTypeRow[]).map((row) => [String(row.id), row]));
}

async function loadDeadlinesById(db: DataClient, organizationId: string, deadlineIds: string[]) {
  if (deadlineIds.length === 0) return new Map<string, DeadlineRow>();
  const { data, error } = await db
    .from("deadlines")
    .select("id, deadline_type_id")
    .eq("organization_id", organizationId)
    .in("id", deadlineIds);
  if (error) throw new Error(readMessage(error));
  return new Map(
    ((data ?? []) as Array<{ id: string; deadline_type_id: string | null }>).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        organization_id: organizationId,
        entity_id: "",
        deadline_type_id: String(row.deadline_type_id ?? ""),
        measure_by: null,
        next_due_date: null,
        last_done_date: null,
        last_done_usage: null,
        frequency: null,
        frequency_unit: null,
        usage_daily_average: null,
        created_at: "",
      },
    ])
  );
}

async function loadUsageFieldDefsById(db: DataClient, organizationId: string, usageFieldIds: string[]) {
  if (usageFieldIds.length === 0) return new Map<string, UsageFieldDefRow>();
  const { data, error } = await db
    .from("usage_fields")
    .select("id, name, key")
    .eq("organization_id", organizationId)
    .in("id", usageFieldIds);
  if (error) throw new Error(readMessage(error));
  return new Map(((data ?? []) as UsageFieldDefRow[]).map((row) => [String(row.id), row]));
}

async function loadEntityFieldDefsById(db: DataClient, organizationId: string, entityFieldIds: string[]) {
  if (entityFieldIds.length === 0) return new Map<string, EntityFieldDefRow>();
  const { data, error } = await db
    .from("entity_fields")
    .select("id, name, key")
    .eq("organization_id", organizationId)
    .in("id", entityFieldIds);
  if (error) throw new Error(readMessage(error));
  return new Map(((data ?? []) as EntityFieldDefRow[]).map((row) => [String(row.id), row]));
}

export async function buildBiDatasetRows(
  db: DataClient,
  organizationId: string,
  datasetKey: BiDatasetKey,
  searchParams: URLSearchParams
) {
  const limit = parsePositiveInt(searchParams.get("limit"), 1000, 10000);
  const offsetRaw = Number(searchParams.get("offset") ?? 0);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0;
  const from = offset;
  const to = offset + limit - 1;

  if (datasetKey === "forecast") {
    const { data, error } = await db
      .from("deadline_forecasts")
      .select("organization_id, entity_id, deadline_id, forecast_due_date, days_remaining, risk_level, risk_score, computed_at")
      .eq("organization_id", organizationId)
      .order("computed_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(readMessage(error));

    const forecasts = (data ?? []) as ForecastRow[];
    const entityIds = Array.from(new Set(forecasts.map((row) => String(row.entity_id)).filter(Boolean)));
    const deadlineIds = Array.from(new Set(forecasts.map((row) => String(row.deadline_id)).filter(Boolean)));

    const entitiesById = await loadEntitiesById(db, organizationId, entityIds);
    const deadlinesById = await loadDeadlinesById(db, organizationId, deadlineIds);
    const deadlineTypeIds = Array.from(
      new Set(Array.from(deadlinesById.values()).map((row) => String(row.deadline_type_id)).filter(Boolean))
    );
    const deadlineTypesById = await loadDeadlineTypesById(db, organizationId, deadlineTypeIds);

    const rows = forecasts.map((row) => {
      const entity = entitiesById.get(String(row.entity_id));
      const deadline = deadlinesById.get(String(row.deadline_id));
      const deadlineType = deadline ? deadlineTypesById.get(String(deadline.deadline_type_id)) : null;
      return {
        organization_id: String(row.organization_id),
        entity_id: String(row.entity_id),
        entity_name: entity?.name ?? null,
        deadline_id: String(row.deadline_id),
        deadline_name: deadlineType?.name ?? null,
        deadline_measure_by: deadlineType?.measure_by ?? null,
        forecast_due_date: row.forecast_due_date,
        days_remaining: row.days_remaining,
        risk_level: String(row.risk_level),
        risk_score: row.risk_score,
        computed_at: String(row.computed_at),
      };
    });
    return { rows, limit, offset };
  }

  if (datasetKey === "deadlines_current") {
    const { data, error } = await db
      .from("deadlines")
      .select("id, organization_id, entity_id, deadline_type_id, measure_by, next_due_date, last_done_date, last_done_usage, frequency, frequency_unit, usage_daily_average, created_at")
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(readMessage(error));

    const deadlines = (data ?? []) as DeadlineRow[];
    const entityIds = Array.from(new Set(deadlines.map((row) => String(row.entity_id)).filter(Boolean)));
    const deadlineTypeIds = Array.from(new Set(deadlines.map((row) => String(row.deadline_type_id)).filter(Boolean)));
    const entitiesById = await loadEntitiesById(db, organizationId, entityIds);
    const entityTypeIds = Array.from(
      new Set(Array.from(entitiesById.values()).map((row) => String(row.entity_type_id ?? "")).filter(Boolean))
    );
    const entityTypesById = await loadEntityTypesById(db, organizationId, entityTypeIds);
    const deadlineTypesById = await loadDeadlineTypesById(db, organizationId, deadlineTypeIds);

    const rows = deadlines.map((row) => {
      const entity = entitiesById.get(String(row.entity_id));
      const entityType = entity?.entity_type_id ? entityTypesById.get(String(entity.entity_type_id)) : null;
      const deadlineType = deadlineTypesById.get(String(row.deadline_type_id));
      return {
        id: String(row.id),
        organization_id: String(row.organization_id),
        entity_id: String(row.entity_id),
        entity_name: entity?.name ?? null,
        entity_type_name: entityType?.name ?? null,
        deadline_type_id: String(row.deadline_type_id),
        deadline_type_name: deadlineType?.name ?? null,
        measure_by: row.measure_by,
        next_due_date: row.next_due_date,
        last_done_date: row.last_done_date,
        last_done_usage: row.last_done_usage,
        frequency: row.frequency,
        frequency_unit: row.frequency_unit,
        usage_daily_average: row.usage_daily_average,
        created_at: String(row.created_at),
        updated_at: String(row.created_at),
      };
    });
    return { rows, limit, offset };
  }

  const dateFrom = String(searchParams.get("date_from") ?? "").trim();
  const dateTo = String(searchParams.get("date_to") ?? "").trim();

  let usageQuery = db
    .from("usage_logs")
    .select("id, organization_id, entity_id, value, value_text, logged_on, logged_at")
    .eq("organization_id", organizationId)
    .order("logged_on", { ascending: false })
    .order("logged_at", { ascending: false })
    .range(from, to);

  if (dateFrom) usageQuery = usageQuery.gte("logged_on", dateFrom);
  if (dateTo) usageQuery = usageQuery.lte("logged_on", dateTo);

  const { data, error } = await usageQuery;
  if (error) throw new Error(readMessage(error));

  const usageLogs = (data ?? []) as UsageLogRow[];
  const usageLogIds = Array.from(new Set(usageLogs.map((row) => String(row.id)).filter(Boolean)));
  const entityIds = Array.from(new Set(usageLogs.map((row) => String(row.entity_id)).filter(Boolean)));

  const usageFieldValuesByLogId = new Map<
    string,
    Array<{
      usage_field_id: string;
      value_text?: string | null;
      value_number?: number | null;
      value_date?: string | null;
      value_boolean?: boolean | null;
    }>
  >();
  if (usageLogIds.length > 0) {
    const { data: usageFieldRows, error: usageFieldErr } = await db
      .from("usage_log_field_values")
      .select("usage_log_id, usage_field_id, value_text, value_number, value_date, value_boolean")
      .eq("organization_id", organizationId)
      .in("usage_log_id", usageLogIds);
    if (usageFieldErr) throw new Error(readMessage(usageFieldErr));

    const usageFieldIds = Array.from(
      new Set(
        ((usageFieldRows ?? []) as Array<{ usage_field_id?: string | null }>)
          .map((row) => String(row.usage_field_id ?? "").trim())
          .filter((value) => value.length > 0)
      )
    );
    const usageFieldDefsById = await loadUsageFieldDefsById(db, organizationId, usageFieldIds);

    for (const row of (usageFieldRows ?? []) as Array<{
      usage_log_id: string;
      usage_field_id: string;
      value_text?: string | null;
      value_number?: number | null;
      value_date?: string | null;
      value_boolean?: boolean | null;
    }>) {
      const usageLogId = String(row.usage_log_id ?? "").trim();
      if (!usageLogId) continue;
      const fieldDef = usageFieldDefsById.get(String(row.usage_field_id ?? ""));
      const fieldName = String(fieldDef?.name ?? fieldDef?.key ?? "").trim();
      if (!fieldName) continue;
      const current = usageFieldValuesByLogId.get(usageLogId) ?? [];
      current.push({ ...row, usage_field_id: fieldName });
      usageFieldValuesByLogId.set(usageLogId, current);
    }
  }

  const entityProfileById = new Map<string, Record<string, string>>();
  if (entityIds.length > 0) {
    const { data: profileRows, error: profileErr } = await db
      .from("entity_field_values")
      .select("entity_id, entity_field_id, value_text")
      .eq("organization_id", organizationId)
      .in("entity_id", entityIds);
    if (profileErr) throw new Error(readMessage(profileErr));

    const entityFieldIds = Array.from(
      new Set(
        ((profileRows ?? []) as Array<{ entity_field_id?: string | null }>)
          .map((row) => String(row.entity_field_id ?? "").trim())
          .filter((value) => value.length > 0)
      )
    );
    const entityFieldDefsById = await loadEntityFieldDefsById(db, organizationId, entityFieldIds);

    for (const row of (profileRows ?? []) as Array<{ entity_id: string; entity_field_id: string; value_text: string | null }>) {
      const entityId = String(row.entity_id ?? "").trim();
      if (!entityId) continue;
      const value = String(row.value_text ?? "").trim();
      if (!value) continue;
      const fieldDef = entityFieldDefsById.get(String(row.entity_field_id ?? ""));
      const fieldName = String(fieldDef?.name ?? fieldDef?.key ?? "").trim();
      if (!fieldName) continue;
      if (!entityProfileById.has(entityId)) entityProfileById.set(entityId, {});
      entityProfileById.get(entityId)![fieldName] = value;
    }
  }

  const entitiesById = await loadEntitiesById(db, organizationId, entityIds);
  const entityTypeIds = Array.from(
    new Set(Array.from(entitiesById.values()).map((row) => String(row.entity_type_id ?? "")).filter(Boolean))
  );
  const usageUnitIds = Array.from(
    new Set(Array.from(entitiesById.values()).map((row) => String(row.usage_unit_id ?? "")).filter(Boolean))
  );
  const entityTypesById = await loadEntityTypesById(db, organizationId, entityTypeIds);
  const usageUnitsById = await loadUsageUnitsById(db, organizationId, usageUnitIds);

  const rows = usageLogs.map((row) => {
    const entity = entitiesById.get(String(row.entity_id));
    const entityType = entity?.entity_type_id ? entityTypesById.get(String(entity.entity_type_id)) : null;
    const usageUnit = entity?.usage_unit_id ? usageUnitsById.get(String(entity.usage_unit_id)) : null;
    const usageFieldValuesRaw = usageFieldValuesByLogId.get(String(row.id)) ?? [];

    const usageFieldValues: Record<string, string | number | boolean> = {};
    for (const valueRow of usageFieldValuesRaw) {
      const fieldName = String(valueRow.usage_field_id ?? "").trim();
      if (!fieldName) continue;
      if (valueRow.value_boolean != null) usageFieldValues[fieldName] = Boolean(valueRow.value_boolean);
      else if (valueRow.value_number != null && Number.isFinite(Number(valueRow.value_number))) usageFieldValues[fieldName] = Number(valueRow.value_number);
      else if (valueRow.value_date != null && String(valueRow.value_date).trim()) usageFieldValues[fieldName] = String(valueRow.value_date);
      else if (valueRow.value_text != null && String(valueRow.value_text).trim()) usageFieldValues[fieldName] = String(valueRow.value_text);
    }

    const entityId = String(row.entity_id);
    return {
      id: String(row.id),
      organization_id: String(row.organization_id),
      entity_id: entityId,
      entity_name: entity?.name ?? null,
      entity_type_name: entityType?.name ?? null,
      usage_unit_name: usageUnit?.name ?? null,
      value: row.value,
      value_text: row.value_text,
      logged_on: String(row.logged_on),
      logged_at: String(row.logged_at),
      entity_profile: entityProfileById.get(entityId) ?? {},
      usage_field_values: usageFieldValues,
    };
  });

  if (datasetKey === "usage_logs_flat") {
    const flattened = rows.map((row) => {
      const out: Record<string, unknown> = {
        id: row.id,
        organization_id: row.organization_id,
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        entity_type_name: row.entity_type_name,
        usage_unit_name: row.usage_unit_name,
        value: row.value,
        value_text: row.value_text,
        logged_on: row.logged_on,
        logged_at: row.logged_at,
      };

      for (const [key, value] of Object.entries(row.entity_profile ?? {})) {
        const sanitized = sanitizeColumnKey(key);
        if (!sanitized) continue;
        out[`entity_profile__${sanitized}`] = value;
      }
      for (const [key, value] of Object.entries(row.usage_field_values ?? {})) {
        const sanitized = sanitizeColumnKey(key);
        if (!sanitized) continue;
        out[`usage_field__${sanitized}`] = value;
      }

      return out;
    });

    return { rows: flattened, limit, offset };
  }

  return { rows, limit, offset };
}
