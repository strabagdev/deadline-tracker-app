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
  const rawValue = payload.value;
  const explicitValueText = payload.value_text == null ? "" : String(payload.value_text).trim();
  const loggedAt = payload.logged_at ? String(payload.logged_at) : new Date().toISOString();
  const loggedOnRaw = payload.logged_on ? String(payload.logged_on).trim() : "";
  const fallbackLoggedOn = (() => {
    const d = new Date(loggedAt);
    if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  })();
  const loggedOn = loggedOnRaw || fallbackLoggedOn;
  const rawFieldValues = Array.isArray(payload.field_values) ? payload.field_values : [];

  let valueNumber: number | null = null;
  let valueText: string | null = null;

  if (rawValue !== undefined && rawValue !== null) {
    if (typeof rawValue === "number") {
      if (!Number.isFinite(rawValue)) return { ok: false as const, error: "value must be finite number or text" };
      valueNumber = rawValue;
    } else {
      const s = String(rawValue).trim();
      if (s) {
        const n = Number(s);
        if (Number.isFinite(n)) valueNumber = n;
        else valueText = s;
      }
    }
  }

  if (!valueText && explicitValueText) valueText = explicitValueText;

  if (!entityId) return { ok: false as const, error: "entity_id required" };
  if (valueNumber == null && !valueText) return { ok: false as const, error: "value or value_text required" };
  if (valueNumber != null && valueNumber < 0) return { ok: false as const, error: "value must be >= 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(loggedOn)) return { ok: false as const, error: "logged_on must be YYYY-MM-DD" };
  for (const raw of rawFieldValues) {
    const item = (raw ?? {}) as Record<string, unknown>;
    const usageFieldId = String(item.usage_field_id ?? "").trim();
    if (!usageFieldId) return { ok: false as const, error: "usage_field_id required in field_values" };
    if (item.value === undefined || item.value === null) return { ok: false as const, error: "value required in field_values" };
  }

  return {
    ok: true as const,
    entityId,
    valueNumber,
    valueText,
    loggedAt,
    loggedOn,
    fieldValues: rawFieldValues.map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        usageFieldId: String(item.usage_field_id ?? "").trim(),
        value: item.value,
      };
    }),
  };
}
