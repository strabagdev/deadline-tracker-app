import test from "node:test";
import assert from "node:assert/strict";
import {
  computeAutoDailyAverageFromList,
  computeDateComputed,
  computeUsageComputed,
  normalizeDashboardMode,
} from "../src/lib/api/dashboardComputations";

function dateIso(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

test("dashboard mode normaliza a manual por defecto", () => {
  assert.equal(normalizeDashboardMode(undefined), "manual");
  assert.equal(normalizeDashboardMode("auto"), "auto");
});

test("dashboard auto average calcula delta/dias con logs validos", async () => {
  const avg = await computeAutoDailyAverageFromList([
    { value: 100, logged_at: dateIso(-5) },
    { value: 150, logged_at: dateIso(0) },
  ]);
  assert.equal(avg, 10);
});

test("dashboard usage computed usa fallback manual en modo auto si autoAvg falta", () => {
  const result = computeUsageComputed({
    latestUsage: 130,
    latestLoggedAt: dateIso(0),
    lastDoneUsage: 100,
    frequency: 60,
    mode: "auto",
    manualAvg: 10,
    autoAvg: null,
  });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.equal(result.daily_average_source, "manual");
    assert.equal(result.days_to_due, 3);
  }
});

test("dashboard date computed retorna incomplete sin next_due_date", () => {
  const result = computeDateComputed(null);
  assert.equal(result.status, "incomplete");
});
