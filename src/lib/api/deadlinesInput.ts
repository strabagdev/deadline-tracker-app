import { normalizeDeadlinesMode, numOrNaN } from "./deadlinesComputations";

type MeasureBy = "date" | "usage";

export function parseDeadlineCreateIds(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const entityId = String(payload.entity_id ?? "").trim();
  const deadlineTypeId = String(payload.deadline_type_id ?? "").trim();

  if (!entityId) return { ok: false as const, status: 400, body: { error: "entity_id required" } };
  if (!deadlineTypeId) return { ok: false as const, status: 400, body: { error: "deadline_type_id required" } };

  return { ok: true as const, entityId, deadlineTypeId };
}

export function parseDeadlineCreatePayload(
  body: unknown,
  ctx: { measureBy: MeasureBy; tracksUsage: boolean }
) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const lastDoneDate = payload.last_done_date ? String(payload.last_done_date) : null;

  if (ctx.measureBy === "date") {
    const nextDueDate = payload.next_due_date ? String(payload.next_due_date) : null;
    if (!nextDueDate) {
      return {
        ok: false as const,
        status: 400,
        body: { error: "next_due_date required for type measure_by=date" },
      };
    }
    return { ok: true as const, measureBy: "date" as const, lastDoneDate, nextDueDate };
  }

  if (!ctx.tracksUsage) {
    return {
      ok: false as const,
      status: 400,
      body: {
        error: "entity does not track usage; cannot create a usage-based deadline",
        code: "TRACKS_USAGE_FALSE",
      },
    };
  }

  const mode = normalizeDeadlinesMode(payload.usage_daily_average_mode);
  const lastDoneUsage = numOrNaN(payload.last_done_usage);
  const frequency = numOrNaN(payload.frequency);
  const frequencyUnit = payload.frequency_unit ? String(payload.frequency_unit) : "";
  const usageDailyAverage = numOrNaN(payload.usage_daily_average);

  if (!Number.isFinite(lastDoneUsage)) return { ok: false as const, status: 400, body: { error: "last_done_usage required" } };
  if (!Number.isFinite(frequency)) return { ok: false as const, status: 400, body: { error: "frequency required" } };
  if (!frequencyUnit) return { ok: false as const, status: 400, body: { error: "frequency_unit required" } };

  if (mode === "manual" && (!Number.isFinite(usageDailyAverage) || usageDailyAverage <= 0)) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "usage_daily_average required for usage_daily_average_mode=manual" },
    };
  }

  return {
    ok: true as const,
    measureBy: "usage" as const,
    lastDoneDate,
    lastDoneUsage,
    frequency,
    frequencyUnit,
    mode,
    usageDailyAverage: Number.isFinite(usageDailyAverage) && usageDailyAverage > 0 ? usageDailyAverage : null,
  };
}
