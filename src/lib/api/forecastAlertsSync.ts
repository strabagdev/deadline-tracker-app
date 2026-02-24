import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataClient = ReturnType<typeof createDataServerClient>;
type RiskLevel = "green" | "yellow" | "orange" | "red" | "none";

type DeadlineRow = {
  id: string;
  entity_id: string;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  usage_daily_average: number | null;
  deadline_types?: {
    name: string | null;
    measure_by: "date" | "usage";
    is_active: boolean;
  } | null;
  entities?: {
    name: string | null;
    tracks_usage: boolean;
  } | null;
};

type ForecastRow = {
  entity_id: string;
  deadline_id: string;
  risk_level: "green" | "yellow" | "orange" | "red" | "none";
  days_remaining: number | null;
  entities?: { name: string | null } | { name: string | null }[] | null;
  deadlines?:
    | { deadline_types?: { name: string | null } | { name: string | null }[] | null }
    | { deadline_types?: { name: string | null } | { name: string | null }[] | null }[]
    | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EVENT_TYPE = "forecast_risk";

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function startOfLocalDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDateOnlyLocal(isoDateOnly: string) {
  const [y, m, d] = isoDateOnly.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function daysUntil(date: Date, now = new Date()): number {
  const due = startOfLocalDay(date);
  const today = startOfLocalDay(now);
  return Math.ceil((due.getTime() - today.getTime()) / MS_PER_DAY);
}

function riskFromDays(
  daysRemaining: number | null,
  thresholds: { yellowDays: number; orangeDays: number; redDays: number }
): { level: RiskLevel; score: number } {
  if (daysRemaining == null || Number.isNaN(daysRemaining)) return { level: "none", score: 0 };
  if (daysRemaining <= 0) return { level: "red", score: 100 };
  if (daysRemaining <= thresholds.orangeDays) return { level: "orange", score: 80 };
  if (daysRemaining <= thresholds.yellowDays) return { level: "yellow", score: 60 };
  return { level: "green", score: 25 };
}

function eventMessage(
  entityName: string,
  deadlineName: string,
  level: ForecastRow["risk_level"],
  daysRemaining: number | null,
  labels: { red: string; orange: string; yellow: string }
) {
  if (level === "red") return `${entityName}: ${deadlineName} ${labels.red.toLowerCase()}${daysRemaining != null ? ` (${daysRemaining} días)` : ""}.`;
  if (level === "orange") return `${entityName}: ${deadlineName} ${labels.orange.toLowerCase()}${daysRemaining != null ? ` (${daysRemaining} días)` : ""}.`;
  if (level === "yellow") return `${entityName}: ${deadlineName} ${labels.yellow.toLowerCase()}${daysRemaining != null ? ` (${daysRemaining} días)` : ""}.`;
  return `${entityName}: ${deadlineName} requiere revisión.`;
}

export async function syncForecastAndAlertsForEntity(db: DataClient, orgId: string, entityId: string) {
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: settingsData, error: settingsErr } = await db
    .from("organization_settings")
    .select("yellow_days, orange_days, red_days, label_red, label_orange, label_yellow")
    .eq("organization_id", orgId)
    .maybeSingle();
  if (settingsErr) throw settingsErr;

  const thresholds = {
    yellowDays: Number(settingsData?.yellow_days ?? 60),
    orangeDays: Number(settingsData?.orange_days ?? 30),
    redDays: Number(settingsData?.red_days ?? 15),
  };
  const labels = {
    red: String(settingsData?.label_red ?? "Vencido"),
    orange: String(settingsData?.label_orange ?? "Por vencer"),
    yellow: String(settingsData?.label_yellow ?? "Aviso"),
  };

  const { data: deadlinesData, error: deadlinesErr } = await db
    .from("deadlines")
    .select(
      `
      id,
      entity_id,
      next_due_date,
      last_done_usage,
      frequency,
      usage_daily_average,
      deadline_types(name, measure_by, is_active),
      entities(name, tracks_usage)
    `
    )
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .eq("is_current", true)
    .eq("deadline_types.is_active", true);
  if (deadlinesErr) throw deadlinesErr;

  const deadlines = (deadlinesData ?? []) as DeadlineRow[];
  const activeDeadlineIds = deadlines.map((d) => d.id);

  const { data: latestUsageData, error: latestUsageErr } = await db
    .from("usage_logs")
    .select("value, logged_on, logged_at")
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .not("value", "is", null)
    .order("logged_on", { ascending: false })
    .order("logged_at", { ascending: false })
    .limit(1);
  if (latestUsageErr) throw latestUsageErr;
  const latest = (latestUsageData ?? [])[0] as { value: number; logged_at: string } | undefined;

  const forecastRows: Array<{
    organization_id: string;
    deadline_id: string;
    entity_id: string;
    forecast_due_date: string | null;
    days_remaining: number | null;
    risk_level: RiskLevel;
    risk_score: number;
    computed_at: string;
  }> = [];

  for (const d of deadlines) {
    const measureBy = d.deadline_types?.measure_by;
    let forecastDueDate: Date | null = null;
    let daysRemaining: number | null = null;

    if (measureBy === "date") {
      if (d.next_due_date) {
        const raw = String(d.next_due_date).trim();
        const due = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? parseDateOnlyLocal(raw) : new Date(raw);
        if (Number.isFinite(due.getTime())) {
          forecastDueDate = due;
          daysRemaining = daysUntil(due, now);
        }
      }
    } else if (measureBy === "usage") {
      const avg = Number(d.usage_daily_average ?? 0);
      const freq = Number(d.frequency ?? NaN);
      const lastDoneUsage = Number(d.last_done_usage ?? NaN);
      const tracksUsage = Boolean(d.entities?.tracks_usage);

      if (
        tracksUsage &&
        latest &&
        Number.isFinite(avg) &&
        avg > 0 &&
        Number.isFinite(freq) &&
        Number.isFinite(lastDoneUsage)
      ) {
        const remainingUsage = freq - (Number(latest.value) - lastDoneUsage);
        const remainingDays = remainingUsage / avg;
        daysRemaining = Number.isFinite(remainingDays) ? Math.ceil(remainingDays) : null;
        if (daysRemaining != null) {
          const base = new Date(String(latest.logged_at));
          forecastDueDate = new Date(base.getTime() + daysRemaining * MS_PER_DAY);
        }
      }
    }

    const risk = riskFromDays(daysRemaining, thresholds);
    forecastRows.push({
      organization_id: orgId,
      deadline_id: d.id,
      entity_id: entityId,
      forecast_due_date: forecastDueDate ? forecastDueDate.toISOString() : null,
      days_remaining: daysRemaining,
      risk_level: risk.level,
      risk_score: risk.score,
      computed_at: nowIso,
    });
  }

  if (forecastRows.length > 0) {
    const { error: upsertForecastErr } = await db
      .from("deadline_forecasts")
      .upsert(forecastRows, { onConflict: "organization_id,deadline_id" });
    if (upsertForecastErr) throw upsertForecastErr;
  }

  const { data: existingForecasts, error: existingForecastsErr } = await db
    .from("deadline_forecasts")
    .select("deadline_id")
    .eq("organization_id", orgId)
    .eq("entity_id", entityId);
  if (existingForecastsErr) throw existingForecastsErr;

  const staleDeadlineIds = Array.from(
    new Set(
      (existingForecasts ?? [])
        .map((r) => String(r.deadline_id ?? ""))
        .filter((id) => id && !activeDeadlineIds.includes(id))
    )
  );
  if (staleDeadlineIds.length > 0) {
    const { error: deleteStaleErr } = await db
      .from("deadline_forecasts")
      .delete()
      .eq("organization_id", orgId)
      .eq("entity_id", entityId)
      .in("deadline_id", staleDeadlineIds);
    if (deleteStaleErr) throw deleteStaleErr;
  }

  const { data: forecastData, error: forecastErr } = await db
    .from("deadline_forecasts")
    .select(
      `
      entity_id,
      deadline_id,
      risk_level,
      days_remaining,
      entities(name),
      deadlines(deadline_types(name))
    `
    )
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .in("risk_level", ["red", "orange", "yellow"]);
  if (forecastErr) throw forecastErr;

  const candidates = ((forecastData ?? []) as ForecastRow[]).map((r) => {
    const entity = pickOne(r.entities);
    const deadline = pickOne(r.deadlines);
    const deadlineType = pickOne(deadline?.deadline_types ?? null);
    const entityName = entity?.name ?? "Entidad";
    const deadlineName = deadlineType?.name ?? "Vencimiento";
    return {
      organization_id: orgId,
      entity_id: r.entity_id,
      deadline_id: r.deadline_id,
      event_type: EVENT_TYPE,
      severity: r.risk_level,
      message: eventMessage(entityName, deadlineName, r.risk_level, r.days_remaining, labels),
    };
  });

  const { data: existingAlertsData, error: existingAlertsErr } = await db
    .from("alert_events")
    .select("id, entity_id, deadline_id, event_type")
    .eq("organization_id", orgId)
    .eq("event_type", EVENT_TYPE)
    .eq("entity_id", entityId)
    .is("resolved_at", null);
  if (existingAlertsErr) throw existingAlertsErr;

  const existing = (existingAlertsData ?? []) as Array<{
    id: string;
    entity_id: string;
    deadline_id: string | null;
    event_type: string;
  }>;
  const existingByKey = new Map(
    existing.map((e) => [`${e.event_type}|${e.entity_id}|${e.deadline_id ?? ""}`, e])
  );

  const candidateKeys = new Set<string>();
  for (const c of candidates) {
    const key = `${c.event_type}|${c.entity_id}|${c.deadline_id ?? ""}`;
    candidateKeys.add(key);
    const match = existingByKey.get(key);
    if (match) {
      const { error: upErr } = await db
        .from("alert_events")
        .update({
          severity: c.severity,
          message: c.message,
          last_seen_at: nowIso,
          resolved_at: null,
        })
        .eq("id", match.id);
      if (upErr) throw upErr;
    } else {
      const { error: insErr } = await db.from("alert_events").insert({
        organization_id: c.organization_id,
        entity_id: c.entity_id,
        deadline_id: c.deadline_id,
        event_type: c.event_type,
        severity: c.severity,
        message: c.message,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
        resolved_at: null,
      });
      if (insErr) throw insErr;
    }
  }

  const toResolveIds = existing
    .filter((e) => !candidateKeys.has(`${e.event_type}|${e.entity_id}|${e.deadline_id ?? ""}`))
    .map((e) => e.id);
  if (toResolveIds.length > 0) {
    const { error: resolveErr } = await db
      .from("alert_events")
      .update({ resolved_at: nowIso })
      .in("id", toResolveIds);
    if (resolveErr) throw resolveErr;
  }
}
