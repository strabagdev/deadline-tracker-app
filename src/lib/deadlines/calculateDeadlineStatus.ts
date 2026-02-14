export type DeadlineStatus = "red" | "orange" | "yellow" | "green" | "none";

export type SemaphoreThresholds = {
  yellowDays: number;
  orangeDays: number;
  redDays: number;
};

export type DeadlineLike = {
  last_done_date?: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  usage_daily_average: number | null;
  deadline_types?: {
    name?: string | null;
    measure_by?: "date" | "usage" | null;
    is_active?: boolean | null;
  } | null;
};

export type DeadlineStatusResult = {
  due: Date | null;
  status: DeadlineStatus;
  label: string;
  typeName: string;
  measureBy: "date" | "usage" | "unknown";
};

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function parseISODateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(base: Date, days: number) {
  return new Date(base.getTime() + days * 86400000);
}

function classify(diffDays: number, thresholds: SemaphoreThresholds) {
  if (diffDays <= 0) return { status: "red" as const, label: "Vencido" };
  if (diffDays <= thresholds.redDays) return { status: "red" as const, label: "Crítico" };
  if (diffDays <= thresholds.orangeDays) return { status: "orange" as const, label: "Por vencer" };
  if (diffDays <= thresholds.yellowDays) return { status: "yellow" as const, label: "Por vencer" };
  return { status: "green" as const, label: "Vigente" };
}

export function calculateDeadlineStatus(deadline: DeadlineLike, latestUsage: number | null, thresholds: SemaphoreThresholds): DeadlineStatusResult {
  const t = deadline.deadline_types;
  const typeName = t?.name ?? "—";
  const measureBy: "date" | "usage" | "unknown" =
    t?.measure_by === "date" || t?.measure_by === "usage" ? t.measure_by : "unknown";

  if (!t) return { due: null, status: "none", label: "Sin tipo", typeName, measureBy };

  const today = new Date();

  if (t.measure_by === "date") {
    if (!deadline.next_due_date) return { due: null, status: "none", label: "Sin fecha", typeName, measureBy: "date" };
    const due = parseISODateOnly(deadline.next_due_date);
    const diff = daysBetween(today, due);
    const c = classify(diff, thresholds);
    return { due, status: c.status, label: c.label, typeName, measureBy: "date" };
  }

  if (deadline.frequency == null || deadline.usage_daily_average == null || Number(deadline.usage_daily_average) <= 0) {
    return { due: null, status: "none", label: "Incompleto", typeName, measureBy: "usage" };
  }

  const avg = Number(deadline.usage_daily_average);
  if (avg <= 0) return { due: null, status: "none", label: "Incompleto", typeName, measureBy: "usage" };

  // Caso 1: cálculo dinámico con uso real.
  if (latestUsage != null && deadline.last_done_usage != null) {
    const usageRestante = Number(deadline.frequency) - (Number(latestUsage) - Number(deadline.last_done_usage));
    if (usageRestante <= 0) return { due: today, status: "red", label: "Vencido", typeName, measureBy: "usage" };

    const diasRestantes = usageRestante / avg;
    const due = addDays(today, diasRestantes);
    const c = classify(diasRestantes, thresholds);
    return { due, status: c.status, label: c.label, typeName, measureBy: "usage" };
  }

  // Caso 2 (fallback): proyección desde última realización.
  // fecha_estimacion = last_done_date + (frequency / usage_daily_average)
  if (deadline.last_done_date) {
    const base = parseISODateOnly(deadline.last_done_date);
    const diasProyectados = Number(deadline.frequency) / avg;
    const due = addDays(base, diasProyectados);
    const diff = daysBetween(today, due);
    const c = classify(diff, thresholds);
    return { due, status: c.status, label: c.label, typeName, measureBy: "usage" };
  }

  return { due: null, status: "none", label: "Incompleto", typeName, measureBy: "usage" };
}

export function pickNearestDeadline(deadlines: DeadlineLike[] | null | undefined, latestUsage: number | null, thresholds: SemaphoreThresholds) {
  const activeDeadlines = (deadlines ?? []).filter((d) => d.deadline_types?.is_active !== false);
  let best: DeadlineStatusResult | null = null;

  for (const d of activeDeadlines) {
    const current = calculateDeadlineStatus(d, latestUsage, thresholds);
    if (!best) {
      best = current;
      continue;
    }
    if (best.due == null && current.due != null) best = current;
    else if (best.due != null && current.due != null && current.due < best.due) best = current;
  }

  return best;
}
