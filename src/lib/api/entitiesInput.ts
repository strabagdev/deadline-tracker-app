export type FieldValueInput = {
  entity_field_id: string;
  value_text: string;
};

export function parseEntityCreateBody(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const name = String(payload.name ?? "").trim();
  const entityTypeId = String(payload.entity_type_id ?? "").trim();
  const tracksUsage = Boolean(payload.tracks_usage ?? false);
  const fieldValues = Array.isArray(payload.field_values) ? (payload.field_values as unknown[]) : [];

  if (!name) return { ok: false as const, error: "name required" };
  if (!entityTypeId) return { ok: false as const, error: "entity_type_id required" };

  return { ok: true as const, name, entityTypeId, tracksUsage, fieldValues };
}

export function normalizeFieldValues(fieldValues: unknown[]): FieldValueInput[] {
  return fieldValues
    .map((fv) => {
      const row = (fv ?? {}) as Record<string, unknown>;
      return {
        entity_field_id: String(row.entity_field_id ?? "").trim(),
        value_text: row.value_text == null ? "" : String(row.value_text),
      };
    })
    .filter((fv) => fv.entity_field_id && String(fv.value_text ?? "").trim() !== "")
    .map((fv) => ({
      entity_field_id: fv.entity_field_id,
      value_text: String(fv.value_text).trim(),
    }));
}

export function parseEntityUpdateBody(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const name = payload.name != null ? String(payload.name).trim() : null;
  const tracksUsage = payload.tracks_usage != null ? Boolean(payload.tracks_usage) : null;
  const fieldValues = Array.isArray(payload.field_values) ? (payload.field_values as unknown[]) : null;

  return { name, tracksUsage, fieldValues };
}

export function splitUpdateFieldValues(fieldValues: unknown[]) {
  const normalized = fieldValues.map((fv) => {
    const row = (fv ?? {}) as Record<string, unknown>;
    return {
      entity_field_id: String(row.entity_field_id ?? "").trim(),
      value_text: row.value_text == null ? "" : String(row.value_text),
    };
  });

  const toUpsert = normalized
    .filter((fv) => fv.entity_field_id && String(fv.value_text ?? "").trim() !== "")
    .map((fv) => ({
      entity_field_id: fv.entity_field_id,
      value_text: String(fv.value_text).trim(),
    }));

  const toDeleteIds = normalized
    .filter((fv) => fv.entity_field_id && String(fv.value_text ?? "").trim() === "")
    .map((fv) => fv.entity_field_id);

  return { toUpsert, toDeleteIds };
}
