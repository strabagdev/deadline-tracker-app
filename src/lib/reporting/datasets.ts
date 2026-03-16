import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataClient = ReturnType<typeof createDataServerClient>;

export const BI_DATASETS = [
  { key: "forecast", label: "Forecast de vencimientos" },
  { key: "deadlines_current", label: "Vencimientos vigentes" },
  { key: "usage_logs", label: "Registros de uso" },
  { key: "usage_logs_flat", label: "Registros de uso (plano BI)" },
] as const;

export type BiDatasetKey = (typeof BI_DATASETS)[number]["key"];

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

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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
      .eq("organization_id", organizationId)
      .order("computed_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = (data ?? []).map((r) => {
      const entity = pickOne((r as { entities?: { name: string | null } | { name: string | null }[] | null }).entities);
      const deadline = pickOne(
        (r as {
          deadlines?:
            | { deadline_types?: { name: string | null; measure_by?: "date" | "usage" | null } | { name: string | null; measure_by?: "date" | "usage" | null }[] | null }
            | { deadline_types?: { name: string | null; measure_by?: "date" | "usage" | null } | { name: string | null; measure_by?: "date" | "usage" | null }[] | null }[]
            | null;
        }).deadlines
      );
      const deadlineType = pickOne(
        (deadline as { deadline_types?: { name: string | null; measure_by?: "date" | "usage" | null } | { name: string | null; measure_by?: "date" | "usage" | null }[] | null } | null)?.deadline_types
      );
      return {
        organization_id: String((r as { organization_id: string }).organization_id),
        entity_id: String((r as { entity_id: string }).entity_id),
        entity_name: entity?.name ?? null,
        deadline_id: String((r as { deadline_id: string }).deadline_id),
        deadline_name: deadlineType?.name ?? null,
        deadline_measure_by: deadlineType?.measure_by ?? null,
        forecast_due_date: (r as { forecast_due_date: string | null }).forecast_due_date,
        days_remaining: (r as { days_remaining: number | null }).days_remaining,
        risk_level: String((r as { risk_level: string }).risk_level),
        risk_score: (r as { risk_score: number | null }).risk_score,
        computed_at: String((r as { computed_at: string }).computed_at),
      };
    });
    return { rows, limit, offset };
  }

  if (datasetKey === "deadlines_current") {
    const { data, error } = await db
      .from("deadlines")
      .select(
        `
        id,
        organization_id,
        entity_id,
        deadline_type_id,
        measure_by,
        next_due_date,
        last_done_date,
        last_done_usage,
        frequency,
        frequency_unit,
        usage_daily_average,
        created_at,
        entities(name, entity_types(name)),
        deadline_types(name)
      `
      )
      .eq("organization_id", organizationId)
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(readMessage(error));

    const rows = (data ?? []).map((r) => {
      const entity = pickOne(
        (r as {
          entities?: { name: string | null; entity_types?: { name: string | null } | { name: string | null }[] | null } | { name: string | null; entity_types?: { name: string | null } | { name: string | null }[] | null }[] | null;
        }).entities
      );
      const entityType = pickOne(entity?.entity_types ?? null);
      const deadlineType = pickOne((r as { deadline_types?: { name: string | null } | { name: string | null }[] | null }).deadline_types);
      return {
        id: String((r as { id: string }).id),
        organization_id: String((r as { organization_id: string }).organization_id),
        entity_id: String((r as { entity_id: string }).entity_id),
        entity_name: entity?.name ?? null,
        entity_type_name: entityType?.name ?? null,
        deadline_type_id: String((r as { deadline_type_id: string }).deadline_type_id),
        deadline_type_name: deadlineType?.name ?? null,
        measure_by: (r as { measure_by: string | null }).measure_by,
        next_due_date: (r as { next_due_date: string | null }).next_due_date,
        last_done_date: (r as { last_done_date: string | null }).last_done_date,
        last_done_usage: (r as { last_done_usage: number | null }).last_done_usage,
        frequency: (r as { frequency: number | null }).frequency,
        frequency_unit: (r as { frequency_unit: string | null }).frequency_unit,
        usage_daily_average: (r as { usage_daily_average: number | null }).usage_daily_average,
        created_at: String((r as { created_at: string }).created_at),
        updated_at: String((r as { created_at: string }).created_at),
      };
    });
    return { rows, limit, offset };
  }

  const dateFrom = String(searchParams.get("date_from") ?? "").trim();
  const dateTo = String(searchParams.get("date_to") ?? "").trim();

  let query = db
    .from("usage_logs")
    .select(
      `
      id,
      organization_id,
      entity_id,
      value,
      value_text,
      logged_on,
      logged_at,
      entities(name, entity_types(name), usage_units(name))
    `
    )
    .eq("organization_id", organizationId)
    .order("logged_on", { ascending: false })
    .order("logged_at", { ascending: false })
    .range(from, to);

  if (dateFrom) query = query.gte("logged_on", dateFrom);
  if (dateTo) query = query.lte("logged_on", dateTo);

  const { data, error } = await query;
  if (error) throw new Error(readMessage(error));

  const usageLogIds = Array.from(
    new Set(
      (data ?? [])
        .map((r) => String((r as { id?: string }).id ?? "").trim())
        .filter((v) => v.length > 0)
    )
  );

  const usageFieldValuesByLogId = new Map<
    string,
    Array<{
      value_text?: string | null;
      value_number?: number | null;
      value_date?: string | null;
      value_boolean?: boolean | null;
      usage_fields?:
        | { name?: string | null; key?: string | null }
        | { name?: string | null; key?: string | null }[]
        | null;
    }>
  >();
  if (usageLogIds.length > 0) {
    const { data: usageFieldRows, error: usageFieldErr } = await db
      .from("usage_log_field_values")
      .select(
        `
        usage_log_id,
        value_text,
        value_number,
        value_date,
        value_boolean,
        usage_fields(name, key)
      `
      )
      .eq("organization_id", organizationId)
      .in("usage_log_id", usageLogIds);
    if (usageFieldErr) throw new Error(readMessage(usageFieldErr));

    for (const row of usageFieldRows ?? []) {
      const usageLogId = String((row as { usage_log_id?: string }).usage_log_id ?? "").trim();
      if (!usageLogId) continue;
      const current = usageFieldValuesByLogId.get(usageLogId) ?? [];
      current.push(row as {
        value_text?: string | null;
        value_number?: number | null;
        value_date?: string | null;
        value_boolean?: boolean | null;
        usage_fields?:
          | { name?: string | null; key?: string | null }
          | { name?: string | null; key?: string | null }[]
          | null;
      });
      usageFieldValuesByLogId.set(usageLogId, current);
    }
  }

  const entityIds = Array.from(
    new Set(
      (data ?? [])
        .map((r) => String((r as { entity_id?: string }).entity_id ?? "").trim())
        .filter((v) => v.length > 0)
    )
  );

  const entityProfileById = new Map<string, Record<string, string>>();
  if (entityIds.length > 0) {
    const { data: profileRows, error: profileErr } = await db
      .from("entity_field_values")
      .select("entity_id, value_text, entity_fields(name, key)")
      .eq("organization_id", organizationId)
      .in("entity_id", entityIds);
    if (profileErr) throw new Error(readMessage(profileErr));

    for (const row of profileRows ?? []) {
      const entityId = String((row as { entity_id?: string }).entity_id ?? "").trim();
      if (!entityId) continue;
      const value = String((row as { value_text?: string | null }).value_text ?? "").trim();
      if (!value) continue;
      const field = pickOne(
        (row as {
          entity_fields?: { name?: string | null; key?: string | null } | { name?: string | null; key?: string | null }[] | null;
        }).entity_fields
      );
      const fieldName = String(field?.name ?? field?.key ?? "").trim();
      if (!fieldName) continue;
      if (!entityProfileById.has(entityId)) entityProfileById.set(entityId, {});
      entityProfileById.get(entityId)![fieldName] = value;
    }
  }

  const rows = (data ?? []).map((r) => {
    const entity = pickOne(
      (r as {
        entities?:
          | { name: string | null; entity_types?: { name: string | null } | { name: string | null }[] | null; usage_units?: { name: string | null } | { name: string | null }[] | null }
          | { name: string | null; entity_types?: { name: string | null } | { name: string | null }[] | null; usage_units?: { name: string | null } | { name: string | null }[] | null }[]
          | null;
      }).entities
    );
    const entityType = pickOne(entity?.entity_types ?? null);
    const usageUnit = pickOne(entity?.usage_units ?? null);
    const usageFieldValuesRaw = usageFieldValuesByLogId.get(String((r as { id: string }).id)) ?? [];

    const usageFieldValues: Record<string, string | number | boolean> = {};
    for (const fv of usageFieldValuesRaw) {
      const field = pickOne(fv.usage_fields ?? null);
      const fieldName = String(field?.name ?? field?.key ?? "").trim();
      if (!fieldName) continue;
      if (fv.value_boolean != null) {
        usageFieldValues[fieldName] = Boolean(fv.value_boolean);
      } else if (fv.value_number != null && Number.isFinite(Number(fv.value_number))) {
        usageFieldValues[fieldName] = Number(fv.value_number);
      } else if (fv.value_date != null && String(fv.value_date).trim()) {
        usageFieldValues[fieldName] = String(fv.value_date);
      } else if (fv.value_text != null && String(fv.value_text).trim()) {
        usageFieldValues[fieldName] = String(fv.value_text);
      }
    }

    const entityId = String((r as { entity_id: string }).entity_id);
    return {
      id: String((r as { id: string }).id),
      organization_id: String((r as { organization_id: string }).organization_id),
      entity_id: entityId,
      entity_name: entity?.name ?? null,
      entity_type_name: entityType?.name ?? null,
      usage_unit_name: usageUnit?.name ?? null,
      value: (r as { value: number | null }).value,
      value_text: (r as { value_text: string | null }).value_text,
      logged_on: String((r as { logged_on: string }).logged_on),
      logged_at: String((r as { logged_at: string }).logged_at),
      entity_profile: entityProfileById.get(entityId) ?? {},
      usage_field_values: usageFieldValues,
    };
  });

  if (datasetKey === "usage_logs_flat") {
    const flattened = rows.map((r) => {
      const out: Record<string, unknown> = {
        id: r.id,
        organization_id: r.organization_id,
        entity_id: r.entity_id,
        entity_name: r.entity_name,
        entity_type_name: r.entity_type_name,
        usage_unit_name: r.usage_unit_name,
        value: r.value,
        value_text: r.value_text,
        logged_on: r.logged_on,
        logged_at: r.logged_at,
      };

      for (const [k, v] of Object.entries(r.entity_profile ?? {})) {
        const key = sanitizeColumnKey(k);
        if (!key) continue;
        out[`entity_profile__${key}`] = v;
      }
      for (const [k, v] of Object.entries(r.usage_field_values ?? {})) {
        const key = sanitizeColumnKey(k);
        if (!key) continue;
        out[`usage_field__${key}`] = v;
      }

      return out;
    });

    return { rows: flattened, limit, offset };
  }

  return { rows, limit, offset };
}
