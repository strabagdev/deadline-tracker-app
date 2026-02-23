import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { handleUsageLogsPost, type UsageLogsRepo } from "@/lib/api/usageLogsService";
import { normalizeEntityTypeName } from "@/lib/usage-capture/slug";
import { syncForecastAndAlertsForEntity } from "@/lib/api/forecastAlertsSync";
import { canViewModule, canViewUsageCaptureEntityType, getOrgAccess } from "@/lib/server/orgAccess";

type DataClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function isUsagePerDayUniqueViolation(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string; details?: string };
  const text = `${maybe.message ?? ""} ${maybe.details ?? ""}`.toLowerCase();
  return maybe.code === "23505" && (text.includes("usage_logs_org_entity_logged_on_uidx") || text.includes("organization_id, entity_id, logged_on"));
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

export async function POST(req: Request) {
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
    const allowed = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "usage_capture");
    if (!allowed) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const entityTypeName = String(body?.entity_type ?? "").trim();
    if (!entityTypeName) {
      return NextResponse.json({ error: "entity_type required", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data: entityTypes, error: typesErr } = await db
      .from("entity_types")
      .select("id, name")
      .eq("organization_id", access.organizationId);
    if (typesErr) throw typesErr;
    const target = normalizeEntityTypeName(entityTypeName);
    const et = (entityTypes ?? []).find((row) => normalizeEntityTypeName(String(row.name ?? "")) === target);
    if (!et?.id) {
      return NextResponse.json({ error: "entity type not found", code: "ENTITY_TYPE_NOT_FOUND" }, { status: 404 });
    }
    const allowedType = await canViewUsageCaptureEntityType(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      String(et.id)
    );
    if (!allowedType) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const entityId = String(body?.entity_id ?? "").trim();
    if (!entityId) {
      return NextResponse.json({ error: "entity_id required", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data: entity, error: entityErr } = await db
      .from("entities")
      .select("id, entity_type_id, tracks_usage, usage_unit_id")
      .eq("organization_id", access.organizationId)
      .eq("id", entityId)
      .maybeSingle();
    if (entityErr) throw entityErr;
    if (!entity?.id || !entity.tracks_usage || String(entity.entity_type_id ?? "") !== String(et.id)) {
      return NextResponse.json({ error: "entity not allowed for this entity type", code: "FORBIDDEN" }, { status: 403 });
    }

    const incomingFieldValues = Array.isArray(body?.field_values) ? body.field_values : [];
    const usageFieldIds = Array.from(
      new Set(
        incomingFieldValues
          .map((f) => String((f as { usage_field_id?: unknown })?.usage_field_id ?? "").trim())
          .filter((id) => id.length > 0)
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
        .eq("organization_id", access.organizationId)
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
    const response = await handleUsageLogsPost(access.organizationId, payload, makeRepo(db));
    const savedEntityId = typeof response.body?.entity_id === "string" ? response.body.entity_id : "";
    if (response.status < 400 && savedEntityId) {
      try {
        await syncForecastAndAlertsForEntity(db, access.organizationId, savedEntityId);
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
