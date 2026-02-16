export function parseUsageLogsGetParams(url: URL) {
  const entityId = String(url.searchParams.get("entity_id") ?? "").trim();
  const limitRaw = parseInt(String(url.searchParams.get("limit") ?? "10"), 10) || 10;
  const limit = Math.min(Math.max(limitRaw, 1), 100);

  if (!entityId) {
    return { ok: false as const, error: "entity_id required" };
  }

  return { ok: true as const, entityId, limit };
}

export function parseUsageLogsCreateBody(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const entityId = String(payload.entity_id ?? "").trim();
  const value = payload.value == null ? NaN : Number(payload.value);
  const loggedAt = payload.logged_at ? String(payload.logged_at) : new Date().toISOString();

  if (!entityId) return { ok: false as const, error: "entity_id required" };
  if (!Number.isFinite(value)) return { ok: false as const, error: "value required" };

  return { ok: true as const, entityId, value, loggedAt };
}
