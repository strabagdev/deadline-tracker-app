import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { handleUsageLogsPost, type UsageLogsRepo } from "@/lib/api/usageLogsService";
import { parseUsageLogsCreateBody } from "@/lib/api/usageLogsInput";
import { normalizeEntityTypeName } from "@/lib/usage-capture/slug";
import { syncForecastAndAlertsForEntity } from "@/lib/api/forecastAlertsSync";
import { canViewModule, canViewUsageCaptureEntityType, getOrgAccess } from "@/lib/server/orgAccess";

type DataClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(error: unknown): string {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as {
      error?: unknown;
      message?: unknown;
      details?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [maybe.error, maybe.message, maybe.details, maybe.hint]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0);
    if (parts.length > 0) return parts.join(" | ");
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // Ignore serialization failures and fall through to default message.
    }
  }
  return "No se pudo guardar el registro de uso.";
}

function isUsagePerDayUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string; details?: string };
  const text = `${maybe.message ?? ""} ${maybe.details ?? ""}`.toLowerCase();
  return maybe.code === "23505" && (text.includes("usage_logs_org_entity_logged_on_uidx") || text.includes("organization_id, entity_id, logged_on"));
}

function isUsageValueNotNullViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string; details?: string };
  const text = `${maybe.message ?? ""} ${maybe.details ?? ""}`.toLowerCase();
  return maybe.code === "23502" && text.includes(`column "value"`) && text.includes("usage_logs");
}

function makeRepo(db: DataClient): UsageLogsRepo {
  return {
    requireEntityInOrg: async (orgId, entityId) => {
      const { data, error } = await db
        .from("entities")
        .select("id")
        .eq("organization_id", orgId)
        .eq("id", entityId)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data?.id);
    },
    listUsageLogs: async () => [],
    getLatestNumericUsageLog: async (orgId, entityId) => {
      const { data, error } = await db
        .from("usage_logs")
        .select("value, logged_on, logged_at")
        .eq("organization_id", orgId)
        .eq("entity_id", entityId)
        .not("value", "is", null)
        .order("logged_on", { ascending: false })
        .order("logged_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as { value: number; logged_on: string | null; logged_at: string } | undefined;
      if (!row || !Number.isFinite(Number(row.value))) return null;
      return {
        value: Number(row.value),
        logged_on: row.logged_on ? String(row.logged_on) : null,
        logged_at: String(row.logged_at),
      };
    },
    getNumericUsageBounds: async (orgId, entityId, loggedOn) => {
      const [previousRes, nextRes] = await Promise.all([
        db
          .from("usage_logs")
          .select("value, logged_on, logged_at")
          .eq("organization_id", orgId)
          .eq("entity_id", entityId)
          .not("value", "is", null)
          .lt("logged_on", loggedOn)
          .order("logged_on", { ascending: false })
          .order("logged_at", { ascending: false })
          .limit(1),
        db
          .from("usage_logs")
          .select("value, logged_on, logged_at")
          .eq("organization_id", orgId)
          .eq("entity_id", entityId)
          .not("value", "is", null)
          .gt("logged_on", loggedOn)
          .order("logged_on", { ascending: true })
          .order("logged_at", { ascending: true })
          .limit(1),
      ]);
      if (previousRes.error) throw previousRes.error;
      if (nextRes.error) throw nextRes.error;
      const previousRow = (previousRes.data ?? [])[0] as { value: number; logged_on: string | null; logged_at: string } | undefined;
      const nextRow = (nextRes.data ?? [])[0] as { value: number; logged_on: string | null; logged_at: string } | undefined;
      return {
        previous:
          previousRow && Number.isFinite(Number(previousRow.value))
            ? {
                value: Number(previousRow.value),
                logged_on: previousRow.logged_on ? String(previousRow.logged_on) : null,
                logged_at: String(previousRow.logged_at),
              }
            : null,
        next:
          nextRow && Number.isFinite(Number(nextRow.value))
            ? {
                value: Number(nextRow.value),
                logged_on: nextRow.logged_on ? String(nextRow.logged_on) : null,
                logged_at: String(nextRow.logged_at),
              }
            : null,
      };
    },
    createUsageLog: async (orgId, entityId, value, valueText, loggedOn, loggedAt) => {
      const { data, error } = await db
        .from("usage_logs")
        .insert({
          organization_id: orgId,
          entity_id: entityId,
          value,
          value_text: valueText,
          logged_on: loggedOn,
          logged_at: loggedAt,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: String(data?.id ?? "") };
    },
    getUsageFieldsByIds: async (orgId, usageFieldIds) => {
      if (usageFieldIds.length === 0) return [];
      const { data, error } = await db
        .from("usage_fields")
        .select("id, field_type")
        .eq("organization_id", orgId)
        .in("id", usageFieldIds);
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: String(r.id), field_type: String(r.field_type) as "text" | "number" | "date" | "boolean" | "select" }));
    },
    createUsageLogFieldValues: async (orgId, usageLogId, fieldValues) => {
      if (fieldValues.length === 0) return;
      const { error } = await db.from("usage_log_field_values").insert(
        fieldValues.map((f) => ({
          organization_id: orgId,
          usage_log_id: usageLogId,
          usage_field_id: f.usageFieldId,
          value_text: f.valueText,
          value_number: f.valueNumber,
          value_date: f.valueDate,
          value_boolean: f.valueBoolean,
        }))
      );
      if (error) throw error;
    },
    getUsageLogById: async () => null,
    deleteUsageLog: async () => undefined,
  };
}

type AccessOk = {
  db: DataClient;
  organizationId: string;
  role: string;
  memberTypeId: string | null;
};

async function getAccess(req: Request): Promise<{ error: NextResponse } | { ok: AccessOk }> {
  const { user } = await requireAuthUser(req);
  const db = createDataServerClient();
  const access = await getOrgAccess(db, user.id);
  if ("error" in access) {
    return {
      error: NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      ),
    };
  }
  return {
    ok: {
      db,
      organizationId: access.organizationId,
      role: access.role,
      memberTypeId: access.memberTypeId ?? null,
    },
  };
}

async function ensureEntityTypeAndEntity(
  db: DataClient,
  organizationId: string,
  role: string,
  memberTypeId: string | null,
  entityTypeName: string,
  entityId: string
) {
  const allowed = await canViewModule(db, organizationId, role, memberTypeId, "usage_capture");
  if (!allowed) return { error: NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 }) };

  const { data: entityTypes, error: typesErr } = await db
    .from("entity_types")
    .select("id, name")
    .eq("organization_id", organizationId);
  if (typesErr) throw typesErr;
  const target = normalizeEntityTypeName(entityTypeName);
  const et = (entityTypes ?? []).find((row) => normalizeEntityTypeName(String(row.name ?? "")) === target);
  if (!et?.id) {
    return { error: NextResponse.json({ error: "entity type not found", code: "ENTITY_TYPE_NOT_FOUND" }, { status: 404 }) };
  }

  const allowedType = await canViewUsageCaptureEntityType(db, organizationId, role, memberTypeId, String(et.id));
  if (!allowedType) return { error: NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 }) };

  const { data: entity, error: entityErr } = await db
    .from("entities")
    .select("id, entity_type_id, tracks_usage, usage_unit_id")
    .eq("organization_id", organizationId)
    .eq("id", entityId)
    .maybeSingle();
  if (entityErr) throw entityErr;
  if (!entity?.id || !entity.tracks_usage || String(entity.entity_type_id ?? "") !== String(et.id)) {
    return { error: NextResponse.json({ error: "entity not allowed for this entity type", code: "FORBIDDEN" }, { status: 403 }) };
  }

  return { entity };
}

async function normalizeFieldValues(
  db: DataClient,
  organizationId: string,
  usageUnitId: string | null,
  incomingFieldValues: Array<{ usageFieldId: string; value: unknown }>
) {
  if (incomingFieldValues.length === 0) return { typed: [] as Array<{ usageFieldId: string; valueText: string | null; valueNumber: number | null; valueDate: string | null; valueBoolean: boolean | null }> };

  const usageFieldIds = Array.from(new Set(incomingFieldValues.map((f) => String(f.usageFieldId)).filter(Boolean)));
  if (!usageUnitId) {
    return {
      error: NextResponse.json(
        { error: "entity has no usage unit assigned for dynamic fields", code: "BAD_REQUEST" },
        { status: 400 }
      ),
    };
  }

  const { data: fields, error: fieldsErr } = await db
    .from("usage_fields")
    .select("id, field_type, usage_unit_id")
    .eq("organization_id", organizationId)
    .eq("usage_unit_id", usageUnitId)
    .in("id", usageFieldIds);
  if (fieldsErr) throw fieldsErr;
  if ((fields ?? []).length !== usageFieldIds.length) {
    return {
      error: NextResponse.json(
        { error: "invalid usage_field_id for entity usage unit", code: "BAD_REQUEST" },
        { status: 400 }
      ),
    };
  }

  const defsById = new Map((fields ?? []).map((f) => [String(f.id), String(f.field_type)]));
  const typedValues: Array<{ usageFieldId: string; valueText: string | null; valueNumber: number | null; valueDate: string | null; valueBoolean: boolean | null }> = [];
  const seen = new Set<string>();
  for (const fv of incomingFieldValues) {
    const usageFieldId = String(fv.usageFieldId ?? "").trim();
    if (!usageFieldId) return { error: NextResponse.json({ error: "usage_field_id required in field_values", code: "BAD_REQUEST" }, { status: 400 }) };
    if (seen.has(usageFieldId)) return { error: NextResponse.json({ error: "duplicate usage_field_id in field_values", code: "BAD_REQUEST" }, { status: 400 }) };
    seen.add(usageFieldId);

    const type = defsById.get(usageFieldId);
    if (!type) {
      return {
        error: NextResponse.json(
          { error: "invalid usage_field_id for entity usage unit", code: "BAD_REQUEST" },
          { status: 400 }
        ),
      };
    }
    if (type === "number") {
      const n = Number(fv.value);
      if (!Number.isFinite(n)) return { error: NextResponse.json({ error: `field ${usageFieldId} requires numeric value`, code: "BAD_REQUEST" }, { status: 400 }) };
      typedValues.push({ usageFieldId, valueText: null, valueNumber: n, valueDate: null, valueBoolean: null });
      continue;
    }
    if (type === "boolean") {
      let b: boolean | null = null;
      if (typeof fv.value === "boolean") b = fv.value;
      else if (typeof fv.value === "string") {
        const s = fv.value.trim().toLowerCase();
        if (s === "true" || s === "1") b = true;
        if (s === "false" || s === "0") b = false;
      } else if (typeof fv.value === "number") {
        if (fv.value === 1) b = true;
        if (fv.value === 0) b = false;
      }
      if (b === null) return { error: NextResponse.json({ error: `field ${usageFieldId} requires boolean value`, code: "BAD_REQUEST" }, { status: 400 }) };
      typedValues.push({ usageFieldId, valueText: null, valueNumber: null, valueDate: null, valueBoolean: b });
      continue;
    }
    if (type === "date") {
      const s = String(fv.value ?? "").trim();
      const d = new Date(s);
      if (!s || !Number.isFinite(d.getTime())) return { error: NextResponse.json({ error: `field ${usageFieldId} requires date value`, code: "BAD_REQUEST" }, { status: 400 }) };
      typedValues.push({ usageFieldId, valueText: null, valueNumber: null, valueDate: d.toISOString().slice(0, 10), valueBoolean: null });
      continue;
    }
    const text = String(fv.value ?? "").trim();
    if (!text) return { error: NextResponse.json({ error: `field ${usageFieldId} requires text value`, code: "BAD_REQUEST" }, { status: 400 }) };
    typedValues.push({ usageFieldId, valueText: text, valueNumber: null, valueDate: null, valueBoolean: null });
  }

  return { typed: typedValues };
}

export async function GET(req: Request) {
  try {
    const accessRes = await getAccess(req);
    if ("error" in accessRes) return accessRes.error;
    const { db, organizationId, role, memberTypeId } = accessRes.ok;

    const url = new URL(req.url);
    const entityTypeName = String(url.searchParams.get("entity_type") ?? "").trim();
    const entityId = String(url.searchParams.get("entity_id") ?? "").trim();
    const loggedOn = String(url.searchParams.get("logged_on") ?? "").trim();
    if (!entityTypeName) return NextResponse.json({ error: "entity_type required", code: "BAD_REQUEST" }, { status: 400 });
    if (!entityId) return NextResponse.json({ error: "entity_id required", code: "BAD_REQUEST" }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(loggedOn)) return NextResponse.json({ error: "logged_on must be YYYY-MM-DD", code: "BAD_REQUEST" }, { status: 400 });

    const scope = await ensureEntityTypeAndEntity(db, organizationId, role, memberTypeId, entityTypeName, entityId);
    if ("error" in scope) return scope.error;

    const { data: log, error: logErr } = await db
      .from("usage_logs")
      .select("id, value, value_text, logged_on, logged_at")
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId)
      .eq("logged_on", loggedOn)
      .maybeSingle();
    if (logErr) throw logErr;
    if (!log?.id) return NextResponse.json({ exists: false });

    const { data: values, error: valuesErr } = await db
      .from("usage_log_field_values")
      .select("usage_field_id, value_text, value_number, value_date, value_boolean")
      .eq("organization_id", organizationId)
      .eq("usage_log_id", log.id);
    if (valuesErr) throw valuesErr;

    const fieldValues = (values ?? []).map((v) => {
      let value = "";
      if (v.value_text != null) value = String(v.value_text);
      else if (v.value_number != null) value = String(v.value_number);
      else if (v.value_date != null) value = String(v.value_date);
      else if (v.value_boolean != null) value = v.value_boolean ? "true" : "false";
      return {
        usage_field_id: String(v.usage_field_id),
        value,
      };
    });

    return NextResponse.json({
      exists: true,
      usage_log: {
        id: String(log.id),
        value: log.value,
        value_text: log.value_text ?? null,
        logged_on: String(log.logged_on ?? loggedOn),
        logged_at: String(log.logged_at ?? ""),
        field_values: fieldValues,
      },
    });
  } catch (error: unknown) {
    if (isUsagePerDayUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Para esta fecha ya hay un registro de uso.", code: "USAGE_ALREADY_EXISTS_FOR_DAY" },
        { status: 409 }
      );
    }
    if (isUsageValueNotNullViolation(error)) {
      return NextResponse.json(
        {
          error: "La base actual todavía exige un valor numérico en usage_logs.value. Debe alinearse para permitir registros de texto.",
          code: "LEGACY_USAGE_VALUE_NOT_NULL",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const accessRes = await getAccess(req);
    if ("error" in accessRes) return accessRes.error;
    const { db, organizationId, role, memberTypeId } = accessRes.ok;

    const body = await req.json().catch(() => ({}));
    const entityTypeName = String(body?.entity_type ?? "").trim();
    if (!entityTypeName) {
      return NextResponse.json({ error: "entity_type required", code: "BAD_REQUEST" }, { status: 400 });
    }

    const entityId = String(body?.entity_id ?? "").trim();
    if (!entityId) {
      return NextResponse.json({ error: "entity_id required", code: "BAD_REQUEST" }, { status: 400 });
    }

    const scope = await ensureEntityTypeAndEntity(db, organizationId, role, memberTypeId, entityTypeName, entityId);
    if ("error" in scope) return scope.error;
    const entity = scope.entity;

    const incomingFieldValues: Array<{ usage_field_id?: unknown }> = Array.isArray(body?.field_values)
      ? (body.field_values as Array<{ usage_field_id?: unknown }>)
      : [];
    const usageFieldIds = Array.from(
      new Set(
        incomingFieldValues
          .map((f: { usage_field_id?: unknown }) => String(f?.usage_field_id ?? "").trim())
          .filter((id: string) => id.length > 0)
      )
    );
    if (usageFieldIds.length > 0) {
      const entityUsageUnitId = String(entity.usage_unit_id ?? "").trim();
      if (!entityUsageUnitId) {
        return NextResponse.json(
          { error: "entity has no usage unit assigned for dynamic fields", code: "BAD_REQUEST" },
          { status: 400 }
        );
      }

      const { data: allowedFields, error: allowedErr } = await db
        .from("usage_fields")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("usage_unit_id", entityUsageUnitId)
        .in("id", usageFieldIds);
      if (allowedErr) throw allowedErr;

      const allowedCount = (allowedFields ?? []).length;
      if (allowedCount !== usageFieldIds.length) {
        return NextResponse.json(
          { error: "invalid usage_field_id for entity usage unit", code: "BAD_REQUEST" },
          { status: 400 }
        );
      }
    }

    const payload = { ...body };
    delete (payload as { token?: unknown }).token;
    const response = await handleUsageLogsPost(organizationId, payload, makeRepo(db));
    const savedEntityId = typeof response.body?.entity_id === "string" ? response.body.entity_id : "";
    if (response.status < 400 && savedEntityId) {
      try {
        await syncForecastAndAlertsForEntity(db, organizationId, savedEntityId);
      } catch (syncErr: unknown) {
        return NextResponse.json(
          {
            ...response.body,
            sync_warning: getErrorMessage(syncErr),
          },
          { status: response.status }
        );
      }
    }

    return NextResponse.json(response.body, { status: response.status });
  } catch (error: unknown) {
    if (isUsagePerDayUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Ya existe un registro para esta entidad en esa fecha.", code: "USAGE_ALREADY_EXISTS_FOR_DAY" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const accessRes = await getAccess(req);
    if ("error" in accessRes) return accessRes.error;
    const { db, organizationId, role, memberTypeId } = accessRes.ok;

    const body = await req.json().catch(() => ({}));
    const parsed = parseUsageLogsCreateBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: "BAD_REQUEST" }, { status: 400 });

    const entityTypeName = String((body as { entity_type?: unknown })?.entity_type ?? "").trim();
    if (!entityTypeName) return NextResponse.json({ error: "entity_type required", code: "BAD_REQUEST" }, { status: 400 });

    const scope = await ensureEntityTypeAndEntity(
      db,
      organizationId,
      role,
      memberTypeId,
      entityTypeName,
      parsed.entityId
    );
    if ("error" in scope) return scope.error;
    const entity = scope.entity;

    const normalized = await normalizeFieldValues(
      db,
      organizationId,
      entity.usage_unit_id ? String(entity.usage_unit_id) : null,
      parsed.fieldValues
    );
    if ("error" in normalized) return normalized.error;

    const { data: existing, error: existingErr } = await db
      .from("usage_logs")
      .select("id, value, logged_on, logged_at")
      .eq("organization_id", organizationId)
      .eq("entity_id", parsed.entityId)
      .eq("logged_on", parsed.loggedOn)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing?.id) {
      return NextResponse.json({ error: "usage log not found for day", code: "USAGE_LOG_NOT_FOUND" }, { status: 404 });
    }

    if (parsed.valueNumber != null) {
      const bounds = await makeRepo(db).getNumericUsageBounds(organizationId, parsed.entityId, parsed.loggedOn);
      if (bounds.previous && parsed.valueNumber < bounds.previous.value) {
        return NextResponse.json(
          {
            error: `El valor no puede ser menor al registro anterior (${bounds.previous.value}).`,
            code: "USAGE_VALUE_CANNOT_DECREASE",
          },
          { status: 400 }
        );
      }
      if (bounds.next && parsed.valueNumber > bounds.next.value) {
        return NextResponse.json(
          {
            error: `El valor no puede ser mayor al registro siguiente (${bounds.next.value}).`,
            code: "USAGE_VALUE_CANNOT_INCREASE_OVER_NEXT",
          },
          { status: 400 }
        );
      }
    }

    const { error: updateErr } = await db
      .from("usage_logs")
      .update({
        value: parsed.valueNumber,
        value_text: parsed.valueText,
        logged_at: parsed.loggedAt,
      })
      .eq("organization_id", organizationId)
      .eq("id", existing.id);
    if (updateErr) throw updateErr;

    const { error: delErr } = await db
      .from("usage_log_field_values")
      .delete()
      .eq("organization_id", organizationId)
      .eq("usage_log_id", existing.id);
    if (delErr) throw delErr;

    if (normalized.typed.length > 0) {
      const { error: insertErr } = await db.from("usage_log_field_values").insert(
        normalized.typed.map((f) => ({
          organization_id: organizationId,
          usage_log_id: existing.id,
          usage_field_id: f.usageFieldId,
          value_text: f.valueText,
          value_number: f.valueNumber,
          value_date: f.valueDate,
          value_boolean: f.valueBoolean,
        }))
      );
      if (insertErr) throw insertErr;
    }

    try {
      await syncForecastAndAlertsForEntity(db, organizationId, parsed.entityId);
    } catch (syncErr: unknown) {
      return NextResponse.json(
        {
          id: String(existing.id),
          entity_id: parsed.entityId,
          updated: true,
          sync_warning: getErrorMessage(syncErr),
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ id: String(existing.id), entity_id: parsed.entityId, updated: true }, { status: 200 });
  } catch (error: unknown) {
    if (isUsagePerDayUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Para esta fecha ya hay un registro de uso.", code: "USAGE_ALREADY_EXISTS_FOR_DAY" },
        { status: 409 }
      );
    }
    if (isUsageValueNotNullViolation(error)) {
      return NextResponse.json(
        {
          error: "La base actual todavía exige un valor numérico en usage_logs.value. Debe alinearse para permitir registros de texto.",
          code: "LEGACY_USAGE_VALUE_NOT_NULL",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
