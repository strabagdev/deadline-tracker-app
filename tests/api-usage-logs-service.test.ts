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
    createUsageLog: async () => ({ id: "u1" }),
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
  const res = await handleUsageLogsPost("o1", { entity_id: "e1", value: 123 }, createRepo());
  assert.equal(res.status, 201);
  assert.equal(res.body.id, "u1");
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
