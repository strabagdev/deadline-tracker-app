import { parseUsageLogsCreateBody, parseUsageLogsGetParams } from "./usageLogsInput";

type UsageLogRow = {
  id: string;
  entity_id: string;
  value: number;
  logged_at: string;
};

type UsageLogRef = {
  id: string;
  organization_id: string;
  entity_id: string;
};

export type UsageLogsRepo = {
  requireEntityInOrg: (orgId: string, entityId: string) => Promise<boolean>;
  listUsageLogs: (orgId: string, entityId: string, limit: number) => Promise<UsageLogRow[]>;
  createUsageLog: (orgId: string, entityId: string, value: number, loggedAt: string) => Promise<{ id: string }>;
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

  const { entityId, value, loggedAt } = parsed;
  const okEntity = await repo.requireEntityInOrg(orgId, entityId);
  if (!okEntity) return { status: 404, body: { error: "entity not found", code: "ENTITY_NOT_FOUND" } };

  const created = await repo.createUsageLog(orgId, entityId, value, loggedAt);
  return { status: 201, body: { id: created.id } };
}

export async function handleUsageLogsDelete(orgId: string, reqUrl: string, repo: UsageLogsRepo): Promise<ServiceResponse> {
  const url = new URL(reqUrl);
  const id = String(url.searchParams.get("id") ?? "").trim();
  if (!id) return { status: 400, body: { error: "id required", code: "BAD_REQUEST" } };

  const existing = await repo.getUsageLogById(orgId, id);
  if (!existing) return { status: 404, body: { error: "usage log not found", code: "USAGE_LOG_NOT_FOUND" } };

  await repo.deleteUsageLog(orgId, id);
  return { status: 200, body: { ok: true } };
}
