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

type RiskLevel = "green" | "yellow" | "orange" | "red" | "none";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function daysUntil(date: Date, now = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / MS_PER_DAY);
}

function riskFromDays(
  daysRemaining: number | null,
  thresholds: { yellowDays: number; orangeDays: number; redDays: number }
): { level: RiskLevel; score: number } {
  if (daysRemaining == null || Number.isNaN(daysRemaining)) return { level: "none", score: 0 };
  if (daysRemaining <= thresholds.redDays) return { level: "red", score: 100 };
  if (daysRemaining <= thresholds.orangeDays) return { level: "orange", score: 80 };
  if (daysRemaining <= thresholds.yellowDays) return { level: "yellow", score: 60 };
  return { level: "green", score: 25 };
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
    const { data: settingsData, error: settingsErr } = await db
      .from("organization_settings")
      .select("yellow_days, orange_days, red_days")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (settingsErr) throw settingsErr;
    const thresholds = {
      yellowDays: Number(settingsData?.yellow_days ?? 60),
      orangeDays: Number(settingsData?.orange_days ?? 30),
      redDays: Number(settingsData?.red_days ?? 15),
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

    const forecastRows: Array<{
      organization_id: string;
      deadline_id: string;
      entity_id: string;
      forecast_due_date: string | null;
      days_remaining: number | null;
      risk_level: RiskLevel;
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

      const risk = riskFromDays(daysRemaining, thresholds);
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

    return NextResponse.json({
      summary: {
        upcoming_7_days: dueIn7,
        upcoming_30_days: dueIn30,
        total_forecasts: forecastRows.length,
      },
      entities: entitiesView,
      computed_at: now.toISOString(),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
