import test from "node:test";
import assert from "node:assert/strict";
import {
  handleUsageLogsDelete,
  handleUsageLogsGet,
  handleUsageLogsPost,
  type UsageLogsRepo,
} from "../src/lib/api/usageLogsService";

function createRepo(overrides?: Partial<UsageLogsRepo>): UsageLogsRepo {
  return {
    requireEntityInOrg: async () => true,
    listUsageLogs: async () => [{ id: "u1", entity_id: "e1", value: 10, logged_at: "2026-01-01T00:00:00.000Z" }],
    getLatestNumericUsageLog: async () => ({ value: 10, logged_on: "2026-01-01", logged_at: "2026-01-01T00:00:00.000Z" }),
    getNumericUsageBounds: async () => ({
      previous: { value: 10, logged_on: "2026-01-01", logged_at: "2026-01-01T00:00:00.000Z" },
      next: null,
    }),
    createUsageLog: async () => ({ id: "u1" }),
    getUsageFieldsByIds: async () => [],
    createUsageLogFieldValues: async () => undefined,
    getUsageLogById: async () => ({ id: "u1", organization_id: "o1", entity_id: "e1" }),
    deleteUsageLog: async () => undefined,
    ...overrides,
  };
}

test("usage logs GET devuelve 400 sin entity_id", async () => {
  const res = await handleUsageLogsGet("o1", "http://localhost/api/usage-logs?limit=10", createRepo());
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "entity_id required");
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("usage logs GET devuelve 404 si la entidad no pertenece a la org", async () => {
  const res = await handleUsageLogsGet(
    "o1",
    "http://localhost/api/usage-logs?entity_id=e1",
    createRepo({ requireEntityInOrg: async () => false })
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "ENTITY_NOT_FOUND");
});

test("usage logs POST devuelve 201 al crear", async () => {
  const res = await handleUsageLogsPost(
    "o1",
    { entity_id: "e1", value: 123, logged_on: "2026-01-02" },
    createRepo({
      getNumericUsageBounds: async () => ({
        previous: { value: 10, logged_on: "2026-01-01", logged_at: "2026-01-01T00:00:00.000Z" },
        next: null,
      }),
    })
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.id, "u1");
});

test("usage logs POST rechaza un valor menor al registro anterior", async () => {
  const res = await handleUsageLogsPost(
    "o1",
    { entity_id: "e1", value: 9, logged_on: "2026-01-02" },
    createRepo({
      getNumericUsageBounds: async () => ({
        previous: { value: 10, logged_on: "2026-01-01", logged_at: "2026-01-01T00:00:00.000Z" },
        next: null,
      }),
    })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "USAGE_VALUE_CANNOT_DECREASE");
});

test("usage logs POST rechaza un valor mayor al registro siguiente", async () => {
  const res = await handleUsageLogsPost(
    "o1",
    { entity_id: "e1", value: 25, logged_on: "2026-01-02" },
    createRepo({
      getNumericUsageBounds: async () => ({
        previous: { value: 10, logged_on: "2026-01-01", logged_at: "2026-01-01T00:00:00.000Z" },
        next: { value: 20, logged_on: "2026-01-03", logged_at: "2026-01-03T00:00:00.000Z" },
      }),
    })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "USAGE_VALUE_CANNOT_INCREASE_OVER_NEXT");
});

test("usage logs DELETE devuelve 404 si no existe", async () => {
  const res = await handleUsageLogsDelete(
    "o1",
    "http://localhost/api/usage-logs?id=u1",
    createRepo({ getUsageLogById: async () => null })
  );
  assert.equal(res.status, 404);
});

test("usage logs DELETE devuelve 200 cuando elimina", async () => {
  const res = await handleUsageLogsDelete("o1", "http://localhost/api/usage-logs?id=u1", createRepo());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("usage logs POST guarda field_values tipados", async () => {
  let inserted = 0;
  const res = await handleUsageLogsPost(
    "o1",
    {
      entity_id: "e1",
      value: 123,
      logged_on: "2026-01-02",
      field_values: [
        { usage_field_id: "f1", value: "10.5" },
        { usage_field_id: "f2", value: "true" },
      ],
    },
    createRepo({
      getUsageFieldsByIds: async () => [
        { id: "f1", field_type: "number" },
        { id: "f2", field_type: "boolean" },
      ],
      createUsageLogFieldValues: async (_orgId, _usageLogId, fieldValues) => {
        inserted = fieldValues.length;
      },
    })
  );
  assert.equal(res.status, 201);
  assert.equal(inserted, 2);
});
