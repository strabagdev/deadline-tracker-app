import test from "node:test";
import assert from "node:assert/strict";
import { handleEntitiesDelete, handleEntitiesPost, handleEntitiesPut, type EntitiesRepo } from "../src/lib/api/entitiesService";

function repo(overrides?: Partial<EntitiesRepo>): EntitiesRepo {
  return {
    createEntity: async () => ({
      id: "e1",
      name: "Equipo A",
      entity_type_id: "t1",
      tracks_usage: true,
      usage_unit_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
    }),
    usageUnitExistsInOrg: async () => true,
    insertFieldValues: async () => undefined,
    getEntityById: async () => ({ id: "e1" }),
    updateEntity: async () => undefined,
    upsertFieldValues: async () => undefined,
    deleteFieldValues: async () => undefined,
    deleteEntity: async () => undefined,
    ...overrides,
  };
}

test("entities POST devuelve 400 con payload invalido", async () => {
  const res = await handleEntitiesPost("o1", {}, repo());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("entities POST crea entidad y devuelve 201", async () => {
  const res = await handleEntitiesPost(
    "o1",
    { name: "Equipo A", entity_type_id: "t1", tracks_usage: true, field_values: [] },
    repo()
  );
  assert.equal(res.status, 201);
  assert.equal((res.body.entity as { id: string }).id, "e1");
});

test("entities POST devuelve 409 cuando el nombre ya existe en el mismo tipo", async () => {
  const res = await handleEntitiesPost(
    "o1",
    { name: "Equipo A", entity_type_id: "t1", tracks_usage: true, field_values: [] },
    repo({
      createEntity: async () => {
        throw { code: "23505", message: "duplicate key value violates unique constraint \"entities_org_type_name_unique\"" };
      },
    })
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "DUPLICATE_ENTITY_NAME");
});

test("entities PUT devuelve 400 sin id", async () => {
  const res = await handleEntitiesPut("o1", "", {}, repo());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("entities PUT devuelve 404 cuando no existe", async () => {
  const res = await handleEntitiesPut("o1", "e1", {}, repo({ getEntityById: async () => null }));
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "ENTITY_NOT_FOUND");
});

test("entities PUT actualiza y devuelve ok", async () => {
  const res = await handleEntitiesPut(
    "o1",
    "e1",
    {
      name: "Equipo B",
      tracks_usage: false,
      field_values: [{ entity_field_id: "f1", value_text: "x" }],
    },
    repo()
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("entities PUT devuelve 409 cuando renombra a un nombre duplicado en el mismo tipo", async () => {
  const res = await handleEntitiesPut(
    "o1",
    "e1",
    { name: "Equipo B" },
    repo({
      updateEntity: async () => {
        throw { code: "23505", message: "duplicate key value violates unique constraint \"entities_org_type_name_unique\"" };
      },
    })
  );
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "DUPLICATE_ENTITY_NAME");
});

test("entities DELETE exige id", async () => {
  const res = await handleEntitiesDelete("o1", "", repo());
  assert.equal(res.status, 400);
});

test("entities DELETE devuelve ok", async () => {
  const res = await handleEntitiesDelete("o1", "e1", repo());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
