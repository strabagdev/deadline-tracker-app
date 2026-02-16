import test from "node:test";
import assert from "node:assert/strict";
import {
  handleDeadlinesDelete,
  handleDeadlinesPost,
  handleDeadlinesPut,
  type DeadlinesRepo,
} from "../src/lib/api/deadlinesService";

function repo(overrides?: Partial<DeadlinesRepo>): DeadlinesRepo {
  return {
    getDeadlineById: async () => ({ id: "d1", entity_id: "e1", deadline_type_id: "dt1", usage_daily_average_mode: "manual" }),
    getEntity: async () => ({ id: "e1", tracks_usage: true }),
    getDeadlineType: async () => ({ id: "dt1", name: "Mantención", measure_by: "usage", is_active: true }),
    createDateDeadline: async () => ({ id: "d1" }),
    createUsageDeadline: async () => ({ id: "d1" }),
    updateDeadline: async () => undefined,
    deleteDeadline: async () => undefined,
    ...overrides,
  };
}

test("deadlines POST valida ids requeridos", async () => {
  const res = await handleDeadlinesPost("o1", {}, repo());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("deadlines POST devuelve 404 si entidad no existe", async () => {
  const res = await handleDeadlinesPost(
    "o1",
    { entity_id: "e1", deadline_type_id: "dt1" },
    repo({ getEntity: async () => null })
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "ENTITY_NOT_FOUND");
});

test("deadlines POST devuelve 400 si tipo inactivo", async () => {
  const res = await handleDeadlinesPost(
    "o1",
    { entity_id: "e1", deadline_type_id: "dt1" },
    repo({ getDeadlineType: async () => ({ id: "dt1", name: "X", measure_by: "date", is_active: false }) })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "DEADLINE_TYPE_INACTIVE");
});

test("deadlines POST crea por fecha", async () => {
  const res = await handleDeadlinesPost(
    "o1",
    { entity_id: "e1", deadline_type_id: "dt1", next_due_date: "2026-12-01" },
    repo({ getDeadlineType: async () => ({ id: "dt1", name: "ITV", measure_by: "date", is_active: true }) })
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.id, "d1");
});

test("deadlines POST crea por uso", async () => {
  const res = await handleDeadlinesPost(
    "o1",
    {
      entity_id: "e1",
      deadline_type_id: "dt1",
      last_done_usage: 100,
      frequency: 50,
      frequency_unit: "km",
      usage_daily_average_mode: "manual",
      usage_daily_average: 10,
    },
    repo({ getDeadlineType: async () => ({ id: "dt1", name: "Horas", measure_by: "usage", is_active: true }) })
  );
  assert.equal(res.status, 201);
  assert.equal(res.body.id, "d1");
});

test("deadlines PUT valida id requerido", async () => {
  const res = await handleDeadlinesPut("o1", {}, repo());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("deadlines PUT devuelve 404 si deadline no existe", async () => {
  const res = await handleDeadlinesPut("o1", { id: "d1" }, repo({ getDeadlineById: async () => null }));
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "DEADLINE_NOT_FOUND");
});

test("deadlines PUT actualiza deadline por fecha", async () => {
  const res = await handleDeadlinesPut(
    "o1",
    { id: "d1", next_due_date: "2026-12-01" },
    repo({
      getDeadlineType: async () => ({ id: "dt1", name: "ITV", measure_by: "date", is_active: true }),
    })
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("deadlines PUT rechaza usage si tracks_usage=false", async () => {
  const res = await handleDeadlinesPut(
    "o1",
    { id: "d1" },
    repo({
      getEntity: async () => ({ id: "e1", tracks_usage: false }),
      getDeadlineType: async () => ({ id: "dt1", name: "Horas", measure_by: "usage", is_active: true }),
    })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "TRACKS_USAGE_FALSE");
});

test("deadlines PUT exige usage_daily_average al cambiar a manual", async () => {
  const res = await handleDeadlinesPut(
    "o1",
    {
      id: "d1",
      usage_daily_average_mode: "manual",
      last_done_usage: 100,
      frequency: 50,
      frequency_unit: "km",
    },
    repo({
      getDeadlineType: async () => ({ id: "dt1", name: "Horas", measure_by: "usage", is_active: true }),
      getDeadlineById: async () => ({ id: "d1", entity_id: "e1", deadline_type_id: "dt1", usage_daily_average_mode: "auto" }),
    })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("deadlines PUT valida tipo numerico en frequency", async () => {
  const res = await handleDeadlinesPut(
    "o1",
    { id: "d1", frequency: "abc" },
    repo({
      getDeadlineType: async () => ({ id: "dt1", name: "Horas", measure_by: "usage", is_active: true }),
    })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("deadlines DELETE valida id", async () => {
  const res = await handleDeadlinesDelete("o1", "", repo());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("deadlines DELETE elimina y responde ok", async () => {
  const res = await handleDeadlinesDelete("o1", "d1", repo());
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
