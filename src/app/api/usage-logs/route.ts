import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";
import {
  handleUsageLogsDelete,
  handleUsageLogsGet,
  handleUsageLogsPost,
  type UsageLogsRepo,
} from "@/lib/api/usageLogsService";
import { syncForecastAndAlertsForEntity } from "@/lib/api/forecastAlertsSync";

type DataClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

async function requireEntityInOrg(db: DataClient, orgId: string, entityId: string) {
  const { data, error } = await db
    .from("entities")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw error;
  return !!data?.id;
}

async function getUsageLogById(db: DataClient, orgId: string, id: string) {
  const { data, error } = await db
    .from("usage_logs")
    .select("id, organization_id, entity_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function makeRepo(db: DataClient): UsageLogsRepo {
  return {
    requireEntityInOrg: (orgId, entityId) => requireEntityInOrg(db, orgId, entityId),
    listUsageLogs: async (orgId, entityId, limit) => {
      const { data, error } = await db
        .from("usage_logs")
        .select("id, entity_id, value, logged_at")
        .eq("organization_id", orgId)
        .eq("entity_id", entityId)
        .order("logged_at", { ascending: false })
        .limit(limit);
      if (error) throw error;

      const logs = (data ?? []) as Array<{
        id: string;
        entity_id: string;
        value: number;
        logged_at: string;
      }>;
      if (logs.length === 0) return [];

      const logIds = logs.map((l) => l.id);
      const { data: valuesData, error: valuesError } = await db
        .from("usage_log_field_values")
        .select(
          `
          usage_log_id,
          usage_field_id,
          value_text,
          value_number,
          value_date,
          value_boolean,
          usage_fields(name, key, field_type)
        `
        )
        .eq("organization_id", orgId)
        .in("usage_log_id", logIds);
      if (valuesError) throw valuesError;

      const byLogId: Record<
        string,
        Array<{
          usage_field_id: string;
          name: string;
          key: string;
          field_type: "text" | "number" | "date" | "boolean" | "select";
          value_text: string | null;
          value_number: number | null;
          value_date: string | null;
          value_boolean: boolean | null;
        }>
      > = {};

      for (const row of (valuesData ?? []) as Array<{
        usage_log_id: string;
        usage_field_id: string;
        value_text: string | null;
        value_number: number | null;
        value_date: string | null;
        value_boolean: boolean | null;
        usage_fields?:
          | { name: string | null; key: string | null; field_type: string | null }
          | { name: string | null; key: string | null; field_type: string | null }[]
          | null;
      }>) {
        const fieldRaw = Array.isArray(row.usage_fields) ? row.usage_fields[0] : row.usage_fields;
        const item = {
          usage_field_id: String(row.usage_field_id),
          name: String(fieldRaw?.name ?? ""),
          key: String(fieldRaw?.key ?? ""),
          field_type: String(fieldRaw?.field_type ?? "text") as "text" | "number" | "date" | "boolean" | "select",
          value_text: row.value_text ?? null,
          value_number: row.value_number != null ? Number(row.value_number) : null,
          value_date: row.value_date ?? null,
          value_boolean: row.value_boolean ?? null,
        };
        if (!byLogId[row.usage_log_id]) byLogId[row.usage_log_id] = [];
        byLogId[row.usage_log_id].push(item);
      }

      return logs.map((l) => ({
        ...l,
        field_values: byLogId[l.id] ?? [],
      }));
    },
    createUsageLog: async (orgId, entityId, value, loggedAt) => {
      const { data, error } = await db
        .from("usage_logs")
        .insert({
          organization_id: orgId,
          entity_id: entityId,
          value,
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
      return (data ?? []).map((r) => ({
        id: String(r.id),
        field_type: String(r.field_type) as "text" | "number" | "date" | "boolean" | "select",
      }));
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
    getUsageLogById: (orgId, id) => getUsageLogById(db, orgId, id),
    deleteUsageLog: async (orgId, id) => {
      const { error } = await db
        .from("usage_logs")
        .delete()
        .eq("organization_id", orgId)
        .eq("id", id);
      if (error) throw error;
    },
  };
}

/**
 * GET /api/usage-logs?entity_id=...&limit=10
 */
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
    const response = await handleUsageLogsGet(access.organizationId, req.url, makeRepo(db));
    return NextResponse.json(response.body, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/**
 * POST /api/usage-logs
 * body: { entity_id, value, logged_at? }
 */
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
    const body = await req.json().catch(() => ({}));
    const response = await handleUsageLogsPost(access.organizationId, body, makeRepo(db));
    const entityId = typeof response.body?.entity_id === "string" ? response.body.entity_id : "";
    if (response.status < 400 && entityId) {
      try {
        await syncForecastAndAlertsForEntity(db, access.organizationId, entityId);
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
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/**
 * DELETE /api/usage-logs?id=...
 */
export async function DELETE(req: Request) {
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
    const response = await handleUsageLogsDelete(access.organizationId, req.url, makeRepo(db));
    const entityId = typeof response.body?.entity_id === "string" ? response.body.entity_id : "";
    if (response.status < 400 && entityId) {
      try {
        await syncForecastAndAlertsForEntity(db, access.organizationId, entityId);
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
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
