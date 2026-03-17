import { parseUsageLogsCreateBody, parseUsageLogsGetParams } from "./usageLogsInput";

type UsageLogRow = {
  id: string;
  entity_id: string;
  value: number | null;
  value_text?: string | null;
  logged_on?: string | null;
  logged_at: string;
  field_values?: Array<{
    usage_field_id: string;
    name: string;
    key: string;
    field_type: "text" | "number" | "date" | "boolean" | "select";
    value_text: string | null;
    value_number: number | null;
    value_date: string | null;
    value_boolean: boolean | null;
  }>;
};

type UsageLogRef = {
  id: string;
  organization_id: string;
  entity_id: string;
};

type UsageFieldDef = {
  id: string;
  field_type: "text" | "number" | "date" | "boolean" | "select";
};

type LatestUsageValue = {
  value: number;
  logged_on: string | null;
  logged_at: string;
};

type NumericUsageBounds = {
  previous: LatestUsageValue | null;
  next: LatestUsageValue | null;
};

type UsageLogFieldValueInput = {
  usageFieldId: string;
  value: unknown;
};

export type UsageLogsRepo = {
  requireEntityInOrg: (orgId: string, entityId: string) => Promise<boolean>;
  listUsageLogs: (orgId: string, entityId: string, limit: number) => Promise<UsageLogRow[]>;
  getLatestNumericUsageLog: (orgId: string, entityId: string) => Promise<LatestUsageValue | null>;
  getNumericUsageBounds: (orgId: string, entityId: string, loggedOn: string) => Promise<NumericUsageBounds>;
  createUsageLog: (
    orgId: string,
    entityId: string,
    value: number | null,
    valueText: string | null,
    loggedOn: string,
    loggedAt: string
  ) => Promise<{ id: string }>;
  getUsageFieldsByIds: (orgId: string, usageFieldIds: string[]) => Promise<UsageFieldDef[]>;
  createUsageLogFieldValues: (
    orgId: string,
    usageLogId: string,
    fieldValues: Array<{
      usageFieldId: string;
      valueText: string | null;
      valueNumber: number | null;
      valueDate: string | null;
      valueBoolean: boolean | null;
    }>
  ) => Promise<void>;
  getUsageLogById: (orgId: string, id: string) => Promise<UsageLogRef | null>;
  deleteUsageLog: (orgId: string, id: string) => Promise<void>;
};

type ServiceResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function handleUsageLogsGet(orgId: string, reqUrl: string, repo: UsageLogsRepo): Promise<ServiceResponse> {
  const parsed = parseUsageLogsGetParams(new URL(reqUrl));
  if (!parsed.ok) return { status: 400, body: { error: parsed.error, code: "BAD_REQUEST" } };

  const { entityId, limit } = parsed;
  const okEntity = await repo.requireEntityInOrg(orgId, entityId);
  if (!okEntity) return { status: 404, body: { error: "entity not found", code: "ENTITY_NOT_FOUND" } };

  const usageLogs = await repo.listUsageLogs(orgId, entityId, limit);
  return { status: 200, body: { usage_logs: usageLogs } };
}

export async function handleUsageLogsPost(
  orgId: string,
  rawBody: unknown,
  repo: UsageLogsRepo
): Promise<ServiceResponse> {
  const parsed = parseUsageLogsCreateBody(rawBody);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error, code: "BAD_REQUEST" } };

  const { entityId, valueNumber, valueText, loggedAt, loggedOn, fieldValues } = parsed;
  const okEntity = await repo.requireEntityInOrg(orgId, entityId);
  if (!okEntity) return { status: 404, body: { error: "entity not found", code: "ENTITY_NOT_FOUND" } };

  if (valueNumber != null) {
    const bounds = await repo.getNumericUsageBounds(orgId, entityId, loggedOn);
    if (bounds.previous && valueNumber < bounds.previous.value) {
      return {
        status: 400,
        body: {
          error: `El valor no puede ser menor al registro anterior (${bounds.previous.value}).`,
          code: "USAGE_VALUE_CANNOT_DECREASE",
        },
      };
    }
    if (bounds.next && valueNumber > bounds.next.value) {
      return {
        status: 400,
        body: {
          error: `El valor no puede ser mayor al registro siguiente (${bounds.next.value}).`,
          code: "USAGE_VALUE_CANNOT_INCREASE_OVER_NEXT",
        },
      };
    }
  }

  const created = await repo.createUsageLog(orgId, entityId, valueNumber, valueText, loggedOn, loggedAt);
  if (fieldValues.length > 0) {
    const deduped = new Map<string, UsageLogFieldValueInput>();
    for (const fv of fieldValues) {
      if (deduped.has(fv.usageFieldId)) {
        return { status: 400, body: { error: "duplicate usage_field_id in field_values", code: "BAD_REQUEST" } };
      }
      deduped.set(fv.usageFieldId, fv);
    }
    const normalized = Array.from(deduped.values());
    const fieldDefs = await repo.getUsageFieldsByIds(
      orgId,
      normalized.map((f) => f.usageFieldId)
    );
    if (fieldDefs.length !== normalized.length) {
      return { status: 400, body: { error: "invalid usage_field_id in field_values", code: "BAD_REQUEST" } };
    }
    const defsById = new Map(fieldDefs.map((f) => [f.id, f]));
    const typedValues: Array<{
      usageFieldId: string;
      valueText: string | null;
      valueNumber: number | null;
      valueDate: string | null;
      valueBoolean: boolean | null;
    }> = [];
    for (const fv of normalized) {
      const def = defsById.get(fv.usageFieldId);
      if (!def) {
        return { status: 400, body: { error: "invalid usage_field_id in field_values", code: "BAD_REQUEST" } };
      }

      if (def.field_type === "number") {
        const n = Number(fv.value);
        if (!Number.isFinite(n)) {
          return { status: 400, body: { error: `field ${fv.usageFieldId} requires numeric value`, code: "BAD_REQUEST" } };
        }
        typedValues.push({
          usageFieldId: fv.usageFieldId,
          valueText: null,
          valueNumber: n,
          valueDate: null,
          valueBoolean: null,
        });
        continue;
      }

      if (def.field_type === "boolean") {
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
        if (b === null) {
          return { status: 400, body: { error: `field ${fv.usageFieldId} requires boolean value`, code: "BAD_REQUEST" } };
        }
        typedValues.push({
          usageFieldId: fv.usageFieldId,
          valueText: null,
          valueNumber: null,
          valueDate: null,
          valueBoolean: b,
        });
        continue;
      }

      if (def.field_type === "date") {
        const s = String(fv.value ?? "").trim();
        const d = new Date(s);
        if (!s || !Number.isFinite(d.getTime())) {
          return { status: 400, body: { error: `field ${fv.usageFieldId} requires date value`, code: "BAD_REQUEST" } };
        }
        typedValues.push({
          usageFieldId: fv.usageFieldId,
          valueText: null,
          valueNumber: null,
          valueDate: d.toISOString().slice(0, 10),
          valueBoolean: null,
        });
        continue;
      }

      const textValue = String(fv.value ?? "").trim();
      if (!textValue) {
        return { status: 400, body: { error: `field ${fv.usageFieldId} requires text value`, code: "BAD_REQUEST" } };
      }
      typedValues.push({
        usageFieldId: fv.usageFieldId,
        valueText: textValue,
        valueNumber: null,
        valueDate: null,
        valueBoolean: null,
      });
    }

    await repo.createUsageLogFieldValues(orgId, created.id, typedValues);
  }
  return { status: 201, body: { id: created.id, entity_id: entityId } };
}

export async function handleUsageLogsDelete(orgId: string, reqUrl: string, repo: UsageLogsRepo): Promise<ServiceResponse> {
  const url = new URL(reqUrl);
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return { status: 400, body: { error: "id required", code: "BAD_REQUEST" } };

  const existing = await repo.getUsageLogById(orgId, id);
  if (!existing) return { status: 404, body: { error: "usage log not found", code: "USAGE_LOG_NOT_FOUND" } };

  await repo.deleteUsageLog(orgId, id);
  return { status: 200, body: { ok: true, entity_id: existing.entity_id } };
}
