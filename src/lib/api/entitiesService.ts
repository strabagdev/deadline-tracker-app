import {
  normalizeFieldValues,
  parseEntityCreateBody,
  parseEntityUpdateBody,
  splitUpdateFieldValues,
} from "./entitiesInput";

type EntityRow = {
  id: string;
  name: string;
  entity_type_id: string;
  tracks_usage: boolean;
  created_at: string;
};

export type EntitiesRepo = {
  createEntity: (orgId: string, input: { name: string; entityTypeId: string; tracksUsage: boolean }) => Promise<EntityRow>;
  insertFieldValues: (
    rows: Array<{ organization_id: string; entity_id: string; entity_field_id: string; value_text: string }>
  ) => Promise<void>;
  getEntityById: (orgId: string, id: string) => Promise<{ id: string } | null>;
  updateEntity: (orgId: string, id: string, patch: Record<string, unknown>) => Promise<void>;
  upsertFieldValues: (
    rows: Array<{ organization_id: string; entity_id: string; entity_field_id: string; value_text: string }>
  ) => Promise<void>;
  deleteFieldValues: (orgId: string, entityId: string, fieldIds: string[]) => Promise<void>;
  deleteEntity: (orgId: string, id: string) => Promise<void>;
};

type ServiceResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function handleEntitiesPost(orgId: string, rawBody: unknown, repo: EntitiesRepo): Promise<ServiceResponse> {
  const parsed = parseEntityCreateBody(rawBody);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  const { name, entityTypeId, tracksUsage, fieldValues } = parsed;
  const entity = await repo.createEntity(orgId, { name, entityTypeId, tracksUsage });

  const rows = normalizeFieldValues(fieldValues).map((fv) => ({
    organization_id: orgId,
    entity_id: entity.id,
    entity_field_id: fv.entity_field_id,
    value_text: String(fv.value_text).trim(),
  }));

  if (rows.length) {
    await repo.insertFieldValues(rows);
  }

  return { status: 201, body: { entity } };
}

export async function handleEntitiesPut(
  orgId: string,
  entityId: string,
  rawBody: unknown,
  repo: EntitiesRepo
): Promise<ServiceResponse> {
  if (!entityId) return { status: 400, body: { error: "id required" } };

  const existing = await repo.getEntityById(orgId, entityId);
  if (!existing) return { status: 404, body: { error: "not found" } };

  const parsed = parseEntityUpdateBody(rawBody);
  const patch: Record<string, unknown> = {};
  if (parsed.name !== null) patch.name = parsed.name;
  if (parsed.tracksUsage !== null) patch.tracks_usage = parsed.tracksUsage;

  if (Object.keys(patch).length) {
    await repo.updateEntity(orgId, entityId, patch);
  }

  if (parsed.fieldValues) {
    const { toUpsert, toDeleteIds } = splitUpdateFieldValues(parsed.fieldValues);

    if (toUpsert.length) {
      await repo.upsertFieldValues(
        toUpsert.map((fv) => ({
          organization_id: orgId,
          entity_id: entityId,
          entity_field_id: fv.entity_field_id,
          value_text: fv.value_text,
        }))
      );
    }

    if (toDeleteIds.length) {
      await repo.deleteFieldValues(orgId, entityId, toDeleteIds);
    }
  }

  return { status: 200, body: { ok: true } };
}

export async function handleEntitiesDelete(orgId: string, entityId: string, repo: EntitiesRepo): Promise<ServiceResponse> {
  if (!entityId) return { status: 400, body: { error: "id required" } };
  await repo.deleteEntity(orgId, entityId);
  return { status: 200, body: { ok: true } };
}
