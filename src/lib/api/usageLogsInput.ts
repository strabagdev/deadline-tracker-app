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
  const rawFieldValues = Array.isArray(payload.field_values) ? payload.field_values : [];

  if (!entityId) return { ok: false as const, error: "entity_id required" };
  if (!Number.isFinite(value)) return { ok: false as const, error: "value required" };
  for (const raw of rawFieldValues) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const usageFieldId = String(item.usage_field_id ?? "").trim();
    if (!usageFieldId) return { ok: false as const, error: "usage_field_id required in field_values" };
    if (item.value === undefined || item.value === null) return { ok: false as const, error: "value required in field_values" };
  }

  return {
    ok: true as const,
    entityId,
    value,
    loggedAt,
    fieldValues: rawFieldValues.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        usageFieldId: String(item.usage_field_id ?? "").trim(),
        value: item.value,
      };
    }),
  };
}
