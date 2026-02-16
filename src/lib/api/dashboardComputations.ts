export type UsageDailyAverageMode = "manual" | "auto";

export type UsageLogPoint = { value: unknown; logged_at: unknown };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function normalizeDashboardMode(val: unknown): UsageDailyAverageMode {
  const s = String(val ?? "").trim().toLowerCase();
  return s === "auto" ? "auto" : "manual";
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

export async function computeAutoDailyAverageFromList(logs: UsageLogPoint[]): Promise<number | null> {
  if (!logs || logs.length < 2) return null;

  const first = logs[0];
  const last = logs[logs.length - 1];

  const v0 = Number(first.value);
  const v1 = Number(last.value);
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;

  const t0 = new Date(String(first.logged_at)).getTime();
  const t1 = new Date(String(last.logged_at)).getTime();
  const days = Math.floor((t1 - t0) / MS_PER_DAY);
  if (!Number.isFinite(days) || days < 1) return null;

  const delta = v1 - v0;
  if (!Number.isFinite(delta) || delta <= 0) return null;

  const avg = delta / days;
  if (!Number.isFinite(avg) || avg <= 0) return null;
  return avg;
}

export function computeUsageComputed(args: {
  latestUsage: number | null;
  latestLoggedAt: string | null;
  lastDoneUsage: number | null;
  frequency: number | null;
  mode: UsageDailyAverageMode;
  manualAvg: number | null;
  autoAvg: number | null;
}) {
  const { latestUsage, latestLoggedAt, lastDoneUsage, frequency, mode, manualAvg, autoAvg } = args;

  let dailyAvg: number | null = null;
  let avgSource: "manual" | "auto" | "none" = "none";

  if (mode === "manual") {
    if (manualAvg && manualAvg > 0) {
      dailyAvg = manualAvg;
      avgSource = "manual";
    }
  } else {
    if (autoAvg && autoAvg > 0) {
      dailyAvg = autoAvg;
      avgSource = "auto";
    } else if (manualAvg && manualAvg > 0) {
      dailyAvg = manualAvg;
      avgSource = "manual";
    }
  }

  if (!Number.isFinite(latestUsage as number)) {
    return {
      status: "incomplete" as const,
      reason: "no_usage_logs" as const,
      current_usage: latestUsage,
      latest_usage_logged_at: latestLoggedAt,
      daily_average: dailyAvg,
      daily_average_source: avgSource,
      usage_daily_average_mode: mode,
    };
  }

  if (!Number.isFinite(lastDoneUsage as number) || !Number.isFinite(frequency as number)) {
    return {
      status: "incomplete" as const,
      reason: "missing_deadline_fields" as const,
      current_usage: latestUsage,
      latest_usage_logged_at: latestLoggedAt,
      daily_average: dailyAvg,
      daily_average_source: avgSource,
      usage_daily_average_mode: mode,
    };
  }

  const usedSinceLast = (latestUsage as number) - (lastDoneUsage as number);
  const remainingUsage = (frequency as number) - usedSinceLast;

  if (!dailyAvg || dailyAvg <= 0) {
    return {
      status: "incomplete" as const,
      reason: "missing_daily_average" as const,
      current_usage: latestUsage,
      latest_usage_logged_at: latestLoggedAt,
      used_since_last: usedSinceLast,
      remaining_usage: remainingUsage,
      daily_average: dailyAvg,
      daily_average_source: avgSource,
      usage_daily_average_mode: mode,
    };
  }

  const estimatedDays = remainingUsage / dailyAvg;
  const daysToDue = Math.floor(estimatedDays);

  return {
    status: "ok" as const,
    current_usage: latestUsage,
    latest_usage_logged_at: latestLoggedAt,
    used_since_last: usedSinceLast,
    remaining_usage: remainingUsage,
    estimated_days: estimatedDays,
    days_to_due: daysToDue,
    semaphore: semaphoreFromDays(daysToDue),
    daily_average: dailyAvg,
    daily_average_source: avgSource,
    usage_daily_average_mode: mode,
  };
}

export function computeDateComputed(nextDueDate: string | null) {
  if (!nextDueDate) return { status: "incomplete" as const, reason: "missing_next_due_date" as const };
  const daysToDue = daysDiffFromNowISO(nextDueDate);
  return {
    status: "ok" as const,
    days_to_due: daysToDue,
    semaphore: semaphoreFromDays(daysToDue),
  };
}
