import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDateStatus,
  computeUsageStatus,
  normalizeDeadlinesMode,
  numOrNaN,
} from "../src/lib/api/deadlinesComputations";

function dateIso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

test("deadlines mode normaliza valores invalidos a manual", () => {
  assert.equal(normalizeDeadlinesMode("AUTO"), "auto");
  assert.equal(normalizeDeadlinesMode("x"), "manual");
});

test("numOrNaN parsea numero y retorna NaN en invalido", () => {
  assert.equal(numOrNaN("12.5"), 12.5);
  assert.ok(Number.isNaN(numOrNaN("foo")));
});

test("computeUsageStatus retorna incomplete sin usage logs", () => {
  const result = computeUsageStatus({
    latestUsage: null,
    lastDoneUsage: 100,
    frequency: 50,
    dailyAverage: 10,
  });
  assert.equal(result.status, "incomplete");
});

test("computeUsageStatus calcula vencimiento por uso", () => {
  const result = computeUsageStatus({
    latestUsage: 120,
    lastDoneUsage: 100,
    frequency: 60,
    dailyAverage: 10,
  });
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.days_to_due, 4);
    assert.equal(result.semaphore, "critical");
  }
});

test("computeDateStatus usa next_due_date", () => {
  const result = computeDateStatus(dateIso(90));
  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.semaphore, "ok");
  }
});
