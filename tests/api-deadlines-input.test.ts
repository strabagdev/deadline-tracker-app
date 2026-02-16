import test from "node:test";
import assert from "node:assert/strict";
import { parseDeadlineCreateIds, parseDeadlineCreatePayload } from "../src/lib/api/deadlinesInput";

test("deadlines create ids exige entity_id y deadline_type_id", () => {
  const bad = parseDeadlineCreateIds({});
  assert.equal(bad.ok, false);

  const ok = parseDeadlineCreateIds({ entity_id: "e1", deadline_type_id: "d1" });
  assert.equal(ok.ok, true);
});

test("deadlines create payload date requiere next_due_date", () => {
  const bad = parseDeadlineCreatePayload({}, { measureBy: "date", tracksUsage: false });
  assert.equal(bad.ok, false);

  const ok = parseDeadlineCreatePayload(
    { last_done_date: "2026-01-01", next_due_date: "2026-02-01" },
    { measureBy: "date", tracksUsage: false }
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.measureBy, "date");
    assert.equal(ok.nextDueDate, "2026-02-01");
  }
});

test("deadlines create payload usage falla con tracks_usage=false", () => {
  const res = parseDeadlineCreatePayload({}, { measureBy: "usage", tracksUsage: false });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.body.code, "TRACKS_USAGE_FALSE");
  }
});

test("deadlines create payload usage valida campos requeridos", () => {
  const bad = parseDeadlineCreatePayload(
    { last_done_usage: 100, frequency: 50, frequency_unit: "km", usage_daily_average_mode: "manual" },
    { measureBy: "usage", tracksUsage: true }
  );
  assert.equal(bad.ok, false);

  const ok = parseDeadlineCreatePayload(
    {
      last_done_usage: 100,
      frequency: 50,
      frequency_unit: "km",
      usage_daily_average_mode: "manual",
      usage_daily_average: 10,
    },
    { measureBy: "usage", tracksUsage: true }
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.measureBy, "usage");
    assert.equal(ok.mode, "manual");
    assert.equal(ok.usageDailyAverage, 10);
  }
});
