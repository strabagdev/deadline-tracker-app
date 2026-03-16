import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDeadlineStatus,
  pickNearestDeadline,
  type DeadlineLike,
  type SemaphoreThresholds,
} from "../src/lib/deadlines/calculateDeadlineStatus";

const thresholds: SemaphoreThresholds = {
  yellowDays: 60,
  orangeDays: 30,
  redDays: 15,
};

function dateOnly(daysFromNow: number): string {
  const now = new Date();
  const d = new Date(now.getTime() + daysFromNow * 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

test("measure_by=date usa next_due_date y entrega estado verde para fecha lejana", () => {
  const deadline: DeadlineLike = {
    next_due_date: dateOnly(90),
    last_done_usage: null,
    frequency: null,
    usage_daily_average: null,
    deadline_types: { measure_by: "date", name: "ITV", is_active: true },
  };

  const result = calculateDeadlineStatus(deadline, null, thresholds);
  assert.equal(result.measureBy, "date");
  assert.equal(result.status, "green");
  assert.ok(result.due instanceof Date);
});

test("measure_by=usage calcula vencimiento usando latestUsage y last_done_usage", () => {
  const deadline: DeadlineLike = {
    next_due_date: null,
    last_done_date: dateOnly(-5),
    last_done_usage: 100,
    frequency: 50,
    usage_daily_average: 10,
    deadline_types: { measure_by: "usage", name: "Mantención", is_active: true },
  };

  // remaining usage = 50 - (130 - 100) = 20; days = 20 / 10 = 2
  const result = calculateDeadlineStatus(deadline, 130, thresholds);
  assert.equal(result.measureBy, "usage");
  assert.ok(result.due instanceof Date);
  assert.equal(result.status, "orange");
});

test("measure_by=usage sin usage logs usa fallback con last_done_date", () => {
  const deadline: DeadlineLike = {
    next_due_date: null,
    last_done_date: dateOnly(-2),
    last_done_usage: 100,
    frequency: 40,
    usage_daily_average: 10,
    deadline_types: { measure_by: "usage", name: "Horas", is_active: true },
  };

  // fallback: last_done_date + (40 / 10) = +4 dias; desde hoy debería quedar aprox +2
  const result = calculateDeadlineStatus(deadline, null, thresholds);
  assert.equal(result.measureBy, "usage");
  assert.ok(result.due instanceof Date);
  assert.notEqual(result.status, "none");
});

test("measure_by=usage con average nulo devuelve incompleto", () => {
  const deadline: DeadlineLike = {
    next_due_date: null,
    last_done_date: dateOnly(-2),
    last_done_usage: 100,
    frequency: 40,
    usage_daily_average: null,
    deadline_types: { measure_by: "usage", name: "Horas", is_active: true },
  };

  const result = calculateDeadlineStatus(deadline, 120, thresholds);
  assert.equal(result.measureBy, "usage");
  assert.equal(result.status, "none");
  assert.equal(result.label, "Incompleto");
});

test("pickNearestDeadline selecciona el vencimiento más próximo", () => {
  const deadlines: DeadlineLike[] = [
    {
      next_due_date: dateOnly(60),
      last_done_usage: null,
      frequency: null,
      usage_daily_average: null,
      deadline_types: { measure_by: "date", name: "A", is_active: true },
    },
    {
      next_due_date: dateOnly(10),
      last_done_usage: null,
      frequency: null,
      usage_daily_average: null,
      deadline_types: { measure_by: "date", name: "B", is_active: true },
    },
  ];

  const nearest = pickNearestDeadline(deadlines, null, thresholds);
  assert.ok(nearest);
  assert.equal(nearest?.typeName, "B");
});
