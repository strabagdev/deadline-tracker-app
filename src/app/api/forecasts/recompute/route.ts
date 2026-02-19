import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";

type DeadlineRow = {
  id: string;
  entity_id: string;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  usage_daily_average: number | null;
  deadline_types?: {
    id: string;
    name: string;
    measure_by: "date" | "usage";
    is_active: boolean;
  } | null;
  entities?: {
    id: string;
    name: string;
    tracks_usage: boolean;
  } | null;
};

type UsageLog = {
  entity_id: string;
  value: number;
  logged_at: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ALERT_DUE_SOON_DAYS = 7;
const ALERT_USAGE_STALE_DAYS = 7;
const ALERT_ABRUPT_CHANGE_THRESHOLD = 0.5; // 50%
const ALERT_MANAGED_TYPES = ["deadline_due_soon", "usage_logs_stale", "usage_avg_abrupt_change"];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function daysUntil(date: Date, now = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / MS_PER_DAY);
}

function riskFromDays(daysRemaining: number | null): { level: "green" | "yellow" | "red"; score: number } {
  if (daysRemaining == null || Number.isNaN(daysRemaining)) return { level: "yellow", score: 50 };
  if (daysRemaining <= 0) return { level: "red", score: 100 };
  if (daysRemaining <= 7) return { level: "red", score: 90 };
  if (daysRemaining <= 30) return { level: "yellow", score: 65 };
  return { level: "green", score: 20 };
}

function computeWindowAverage(logsAsc: UsageLog[], fromMs: number, toMs: number): number | null {
  const slice = logsAsc.filter((l) => {
    const t = new Date(l.logged_at).getTime();
    return t >= fromMs && t <= toMs;
  });
  if (slice.length < 2) return null;
  const first = slice[0];
  const last = slice[slice.length - 1];
  const days = (new Date(last.logged_at).getTime() - new Date(first.logged_at).getTime()) / MS_PER_DAY;
  if (!Number.isFinite(days) || days <= 0) return null;
  const diff = Number(last.value) - Number(first.value);
  return diff / days;
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }

    const orgId = access.organizationId;
    const now = new Date();

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
        deadline_types(id, name, measure_by, is_active),
        entities(id, name, tracks_usage)
      `
      )
      .eq("organization_id", orgId)
      .eq("deadline_types.is_active", true);

    if (deadlinesErr) throw deadlinesErr;
    const deadlines = (deadlinesData ?? []) as DeadlineRow[];

    const entityIds = Array.from(new Set(deadlines.map((d) => d.entity_id)));

    const latestUsageByEntity = new Map<string, { value: number; logged_at: string }>();
    await Promise.all(
      entityIds.map(async (entityId) => {
        const { data, error } = await db
          .from("usage_logs")
          .select("value, logged_at")
          .eq("organization_id", orgId)
          .eq("entity_id", entityId)
          .order("logged_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        const row = (data ?? [])[0] as { value: number; logged_at: string } | undefined;
        if (row) latestUsageByEntity.set(entityId, { value: Number(row.value), logged_at: String(row.logged_at) });
      })
    );

    const since30 = new Date(now.getTime() - 30 * MS_PER_DAY).toISOString();
    const recentLogsByEntity = new Map<string, UsageLog[]>();
    if (entityIds.length > 0) {
      const { data: logsData, error: logsErr } = await db
        .from("usage_logs")
        .select("entity_id, value, logged_at")
        .eq("organization_id", orgId)
        .in("entity_id", entityIds)
        .gte("logged_at", since30)
        .order("logged_at", { ascending: true });
      if (logsErr) throw logsErr;
      for (const row of (logsData ?? []) as UsageLog[]) {
        if (!recentLogsByEntity.has(row.entity_id)) recentLogsByEntity.set(row.entity_id, []);
        recentLogsByEntity.get(row.entity_id)?.push({
          entity_id: row.entity_id,
          value: Number(row.value),
          logged_at: String(row.logged_at),
        });
      }
    }

    const forecastRows: Array<{
      organization_id: string;
      deadline_id: string;
      entity_id: string;
      forecast_due_date: string | null;
      days_remaining: number | null;
      risk_level: "green" | "yellow" | "red";
      risk_score: number;
      computed_at: string;
      deadline_name: string;
      entity_name: string;
    }> = [];

    for (const d of deadlines) {
      const measureBy = d.deadline_types?.measure_by;
      const entityName = d.entities?.name ?? "Entidad";
      const deadlineName = d.deadline_types?.name ?? "Vencimiento";

      let forecastDueDate: Date | null = null;
      let daysRemaining: number | null = null;

      if (measureBy === "date") {
        if (d.next_due_date) {
          const due = new Date(d.next_due_date);
          if (Number.isFinite(due.getTime())) {
            forecastDueDate = due;
            daysRemaining = daysUntil(due, now);
          }
        }
      } else if (measureBy === "usage") {
        const latest = latestUsageByEntity.get(d.entity_id);
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
          const remainingUsage = freq - (latest.value - lastDoneUsage);
          const remainingDays = remainingUsage / avg;
          daysRemaining = Number.isFinite(remainingDays) ? Math.ceil(remainingDays) : null;
          if (daysRemaining != null) {
            const base = new Date(latest.logged_at);
            forecastDueDate = new Date(base.getTime() + daysRemaining * MS_PER_DAY);
          }
        }
      }

      const risk = riskFromDays(daysRemaining);
      forecastRows.push({
        organization_id: orgId,
        deadline_id: d.id,
        entity_id: d.entity_id,
        forecast_due_date: forecastDueDate ? forecastDueDate.toISOString() : null,
        days_remaining: daysRemaining,
        risk_level: risk.level,
        risk_score: risk.score,
        computed_at: now.toISOString(),
        deadline_name: deadlineName,
        entity_name: entityName,
      });
    }

    if (forecastRows.length > 0) {
      const { error: upsertForecastErr } = await db.from("deadline_forecasts").upsert(
        forecastRows.map((f) => ({
          organization_id: f.organization_id,
          deadline_id: f.deadline_id,
          entity_id: f.entity_id,
          forecast_due_date: f.forecast_due_date,
          days_remaining: f.days_remaining,
          risk_level: f.risk_level,
          risk_score: f.risk_score,
          computed_at: f.computed_at,
        })),
        { onConflict: "organization_id,deadline_id" }
      );
      if (upsertForecastErr) throw upsertForecastErr;
    }

    const { error: resolveErr } = await db
      .from("alerts")
      .update({ resolved_at: now.toISOString() })
      .eq("organization_id", orgId)
      .is("resolved_at", null)
      .in("type", ALERT_MANAGED_TYPES);
    if (resolveErr) throw resolveErr;

    const alertsToInsert: Array<{
      organization_id: string;
      entity_id: string;
      deadline_id: string | null;
      type: string;
      severity: string;
      message: string;
      created_at: string;
      resolved_at: null;
    }> = [];

    for (const f of forecastRows) {
      if (f.days_remaining != null && f.days_remaining <= ALERT_DUE_SOON_DAYS) {
        alertsToInsert.push({
          organization_id: orgId,
          entity_id: f.entity_id,
          deadline_id: f.deadline_id,
          type: "deadline_due_soon",
          severity: f.days_remaining <= 0 ? "red" : "yellow",
          message:
            f.days_remaining <= 0
              ? `${f.entity_name}: ${f.deadline_name} está vencido.`
              : `${f.entity_name}: ${f.deadline_name} vence en ${f.days_remaining} día(s).`,
          created_at: now.toISOString(),
          resolved_at: null,
        });
      }
    }

    const staleLimit = new Date(now.getTime() - ALERT_USAGE_STALE_DAYS * MS_PER_DAY).getTime();
    const usageEntities = new Map<string, string>();
    for (const d of deadlines) {
      if (d.deadline_types?.measure_by !== "usage") continue;
      usageEntities.set(d.entity_id, d.entities?.name ?? "Entidad");
    }
    for (const [entityId, entityName] of usageEntities.entries()) {
      const latest = latestUsageByEntity.get(entityId);
      const latestTs = latest ? new Date(latest.logged_at).getTime() : 0;
      if (!latest || latestTs < staleLimit) {
        alertsToInsert.push({
          organization_id: orgId,
          entity_id: entityId,
          deadline_id: null,
          type: "usage_logs_stale",
          severity: "yellow",
          message: `${entityName}: sin registros de uso recientes.`,
          created_at: now.toISOString(),
          resolved_at: null,
        });
      }
    }

    for (const entityId of entityIds) {
      const logs = recentLogsByEntity.get(entityId) ?? [];
      if (logs.length < 2) continue;

      const nowMs = now.getTime();
      const recentFrom = nowMs - 7 * MS_PER_DAY;
      const prevFrom = nowMs - 14 * MS_PER_DAY;
      const prevTo = recentFrom;

      const recentAvg = computeWindowAverage(logs, recentFrom, nowMs);
      const prevAvg = computeWindowAverage(logs, prevFrom, prevTo);
      if (recentAvg == null || prevAvg == null || prevAvg === 0) continue;

      const relativeChange = Math.abs(recentAvg - prevAvg) / Math.abs(prevAvg);
      if (relativeChange >= ALERT_ABRUPT_CHANGE_THRESHOLD) {
        const anyDeadline = deadlines.find((d) => d.entity_id === entityId);
        alertsToInsert.push({
          organization_id: orgId,
          entity_id: entityId,
          deadline_id: anyDeadline?.id ?? null,
          type: "usage_avg_abrupt_change",
          severity: relativeChange >= 1 ? "red" : "yellow",
          message: `${anyDeadline?.entities?.name ?? "Entidad"}: cambio abrupto del promedio diario de uso (${Math.round(
            relativeChange * 100
          )}%).`,
          created_at: now.toISOString(),
          resolved_at: null,
        });
      }
    }

    if (alertsToInsert.length > 0) {
      const { error: alertsErr } = await db.from("alerts").insert(alertsToInsert);
      if (alertsErr) throw alertsErr;
    }

    const { count: activeAlertsCount, error: countErr } = await db
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("resolved_at", null);
    if (countErr) throw countErr;

    const nearestByEntity = new Map<
      string,
      {
        entity_id: string;
        entity_name: string;
        deadline_id: string;
        deadline_name: string;
        forecast_due_date: string | null;
        days_remaining: number | null;
        risk_level: string;
        risk_score: number;
      }
    >();

    for (const row of forecastRows) {
      const current = nearestByEntity.get(row.entity_id);
      const rowDays = row.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const currentDays = current?.days_remaining ?? Number.MAX_SAFE_INTEGER;
      if (!current || rowDays < currentDays) {
        nearestByEntity.set(row.entity_id, {
          entity_id: row.entity_id,
          entity_name: row.entity_name,
          deadline_id: row.deadline_id,
          deadline_name: row.deadline_name,
          forecast_due_date: row.forecast_due_date,
          days_remaining: row.days_remaining,
          risk_level: row.risk_level,
          risk_score: row.risk_score,
        });
      }
    }

    const entitiesView = Array.from(nearestByEntity.values()).sort((a, b) => {
      const da = a.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const db = b.days_remaining ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });

    const dueIn7 = forecastRows.filter((f) => f.days_remaining != null && f.days_remaining <= 7).length;
    const dueIn30 = forecastRows.filter((f) => f.days_remaining != null && f.days_remaining <= 30).length;

    const { data: activeAlertsData, error: activeAlertsErr } = await db
      .from("alerts")
      .select("id, entity_id, deadline_id, type, severity, message, created_at")
      .eq("organization_id", orgId)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (activeAlertsErr) throw activeAlertsErr;

    return NextResponse.json({
      summary: {
        upcoming_7_days: dueIn7,
        upcoming_30_days: dueIn30,
        active_alerts: activeAlertsCount ?? 0,
        total_forecasts: forecastRows.length,
      },
      entities: entitiesView,
      alerts: activeAlertsData ?? [],
      computed_at: now.toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
