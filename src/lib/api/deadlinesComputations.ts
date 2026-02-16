export type UsageDailyAverageMode = "manual" | "auto";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeDeadlinesMode(val: unknown): UsageDailyAverageMode {
  const s = String(val ?? "").trim().toLowerCase();
  return s === "auto" ? "auto" : "manual";
}

export function numOrNaN(v: unknown) {
  if (v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function daysDiffFromNowISO(dateIso: string) {
  const d = new Date(dateIso);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / MS_PER_DAY);
}

export function semaphoreFromDays(days: number): "ok" | "warn" | "urgent" | "critical" | "expired" {
  if (days <= 0) return "expired";
  if (days <= 15) return "critical";
  if (days <= 30) return "urgent";
  if (days <= 60) return "warn";
  return "ok";
}

export function computeUsageStatus(args: {
  latestUsage: number | null;
  lastDoneUsage: number | null;
  frequency: number | null;
  dailyAverage: number | null;
}) {
  const { latestUsage, lastDoneUsage, frequency, dailyAverage } = args;

  if (!Number.isFinite(latestUsage as number)) {
    return { status: "incomplete" as const, reason: "no_usage_logs" as const };
  }
  if (!Number.isFinite(lastDoneUsage as number) || !Number.isFinite(frequency as number)) {
    return { status: "incomplete" as const, reason: "missing_deadline_fields" as const };
  }
  const usedSinceLast = (latestUsage as number) - (lastDoneUsage as number);
  if (!Number.isFinite(usedSinceLast)) {
    return { status: "incomplete" as const, reason: "bad_usage_values" as const };
  }
  const remainingUsage = (frequency as number) - usedSinceLast;

  if (!Number.isFinite(dailyAverage as number) || (dailyAverage as number) <= 0) {
    return {
      status: "incomplete" as const,
      reason: "missing_daily_average" as const,
      used_since_last: usedSinceLast,
      remaining_usage: remainingUsage,
    };
  }

  const estimatedDays = remainingUsage / (dailyAverage as number);
  if (!Number.isFinite(estimatedDays)) {
    return { status: "incomplete" as const, reason: "bad_estimate" as const };
  }

  const daysToDue = Math.floor(estimatedDays);

  return {
    status: "ok" as const,
    used_since_last: usedSinceLast,
    remaining_usage: remainingUsage,
    estimated_days: estimatedDays,
    days_to_due: daysToDue,
    semaphore: semaphoreFromDays(daysToDue),
  };
}

export function computeDateStatus(nextDueDate: string | null) {
  if (!nextDueDate) return { status: "incomplete" as const, reason: "missing_next_due_date" as const };
  const daysToDue = daysDiffFromNowISO(nextDueDate);
  return {
    status: "ok" as const,
    days_to_due: daysToDue,
    semaphore: semaphoreFromDays(daysToDue),
  };
}
