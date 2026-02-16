import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";

type MeasureBy = "date" | "usage";
type UsageDailyAverageMode = "manual" | "auto";
type DataClient = ReturnType<typeof createDataServerClient>;

type UsageLogPoint = { value: unknown; logged_at: unknown };
type LatestUsage = { value: number; logged_at: string };

type DashboardDeadlineRow = {
  id: string;
  entity_id: string;
  deadline_type_id: string;
  last_done_date: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_daily_average_mode: string | null;
  created_at: string;
  deadline_types?: {
    id: string;
    name: string;
    measure_by: MeasureBy;
    requires_document: boolean;
    is_active: boolean;
  } | null;
  measure_by?: MeasureBy | null;
};

type DashboardEntityRow = {
  id: string;
  name: string;
  created_at: string;
  entity_type_id: string | null;
  tracks_usage: boolean;
  entity_types?: { id: string; name: string } | null;
  deadlines?: DashboardDeadlineRow[] | null;
};

type ComputedDashboardDeadline = DashboardDeadlineRow & {
  computed?: ReturnType<typeof computeDateComputed> | ReturnType<typeof computeUsageComputed> | { status: "incomplete"; reason: string };
  __tmp_usage?: { mode: UsageDailyAverageMode; manualAvg: number | null };
  __tmp_latest?: LatestUsage | null;
  __tmp_autoAvgPromise?: Promise<number | null>;
};

type ComputedDashboardEntity = Omit<DashboardEntityRow, "deadlines"> & {
  deadlines: ComputedDashboardDeadline[];
  current_usage?: number | null;
  current_usage_logged_at?: string | null;
  auto_usage_daily_average?: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

function normalizeMode(val: unknown): UsageDailyAverageMode {
  const s = String(val ?? "").trim().toLowerCase();
  return s === "auto" ? "auto" : "manual";
}

function daysDiffFromNowISO(dateIso: string) {
  const d = new Date(dateIso);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / MS_PER_DAY);
}

function semaphoreFromDays(days: number): "ok" | "warn" | "urgent" | "critical" | "expired" {
  // thresholds: 60 / 30 / 15 / 0 (expired)
  if (days <= 0) return "expired";
  if (days <= 15) return "critical";
  if (days <= 30) return "urgent";
  if (days <= 60) return "warn";
  return "ok";
}

async function getLatestUsageByEntity(db: DataClient, orgId: string, entityIds: string[]) {
  const entries = await Promise.all(
    entityIds.map(async (entityId) => {
      const { data, error } = await db
        .from("usage_logs")
        .select("value, logged_at")
        .eq("organization_id", orgId)
        .eq("entity_id", entityId)
        .order("logged_at", { ascending: false })
        .limit(1);

      if (error) throw error;

      const row = (data ?? [])[0];
      if (!row) return null;
      return [entityId, { value: Number(row.value), logged_at: String(row.logged_at) }] as const;
    })
  );

  const out: Record<string, LatestUsage> = {};
  for (const entry of entries) {
    if (entry) out[entry[0]] = entry[1];
  }
  return out;
}

async function computeAutoDailyAverageFromList(logs: UsageLogPoint[]): Promise<number | null> {
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

function computeUsageComputed(args: {
  latestUsage: number | null;
  latestLoggedAt: string | null;
  lastDoneUsage: number | null;
  frequency: number | null;
  mode: UsageDailyAverageMode;
  manualAvg: number | null;
  autoAvg: number | null;
}) {
  const { latestUsage, latestLoggedAt, lastDoneUsage, frequency, mode, manualAvg, autoAvg } = args;

  // pick daily average following Option C
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

function computeDateComputed(nextDueDate: string | null) {
  if (!nextDueDate) return { status: "incomplete" as const, reason: "missing_next_due_date" as const };
  const daysToDue = daysDiffFromNowISO(nextDueDate);
  return {
    status: "ok" as const,
    days_to_due: daysToDue,
    semaphore: semaphoreFromDays(daysToDue),
  };
}

/**
 * Dashboard: returns entities with deadlines already computed, so frontend doesn't duplicate logic.
 * Also returns latest_usage_by_entity for badges, etc.
 */
export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const orgId = access.organizationId;

    // Entities + deadlines + type
    const { data: entities, error: entErr } = await db
      .from("entities")
      .select(
        `
        id,
        name,
        created_at,
        entity_type_id,
        tracks_usage,
        entity_types(id, name),
        deadlines(
          id,
          entity_id,
          deadline_type_id,
          last_done_date,
          next_due_date,
          last_done_usage,
          frequency,
          frequency_unit,
          usage_daily_average,
          usage_daily_average_mode,
          created_at,
          deadline_types(id, name, measure_by, requires_document, is_active)
        )
      `
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (entErr) throw entErr;

    const entityRows = (entities ?? []) as DashboardEntityRow[];
    const entityIds = entityRows.map((e) => e.id);

    // Fetch recent logs for auto daily average (mode=auto).
    const logsByEntity: Record<string, UsageLogPoint[]> = {};
    const latestUsageByEntity: Record<string, LatestUsage> = {};

    if (entityIds.length > 0) {
      Object.assign(latestUsageByEntity, await getLatestUsageByEntity(db, orgId, entityIds));

      const since = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();

      const { data: logs, error: logErr } = await db
        .from("usage_logs")
        .select("entity_id, value, logged_at")
        .eq("organization_id", orgId)
        .in("entity_id", entityIds)
        .gte("logged_at", since)
        .order("logged_at", { ascending: true })
        .limit(10000);

      if (logErr) throw logErr;

      for (const row of (logs ?? []) as Array<{ entity_id: string; value: unknown; logged_at: unknown }>) {
        const id = row.entity_id as string;
        if (!logsByEntity[id]) logsByEntity[id] = [];
        logsByEntity[id].push({ value: row.value, logged_at: row.logged_at });
      }
    }

    // Compute per-deadline fields
    const computedEntities = entityRows.map((entity): ComputedDashboardEntity => {
      const logs = logsByEntity[entity.id] ?? [];
      const latest = latestUsageByEntity[entity.id] ?? null;

      // compute auto avg once per entity (reused for all usage deadlines)
      const autoAvgPromise = computeAutoDailyAverageFromList(logs);

      const deadlines = (entity.deadlines ?? []).map((d): ComputedDashboardDeadline => {
        const measureBy = (d?.deadline_types?.measure_by ?? d?.measure_by) as MeasureBy | undefined;
        if (!measureBy) return { ...d, computed: { status: "incomplete", reason: "missing_measure_by" } };

        if (measureBy === "date") {
          return { ...d, computed: computeDateComputed(d?.next_due_date ?? null) };
        }

        // usage
        // If entity doesn't track usage, flag as invalid/incomplete (shouldn't exist if backend validation is enforced)
        if (!entity.tracks_usage) {
          return {
            ...d,
            computed: { status: "incomplete", reason: "tracks_usage_false" },
          };
        }

        const mode = normalizeMode(d?.usage_daily_average_mode);
        const manualAvg = Number.isFinite(Number(d?.usage_daily_average)) ? Number(d.usage_daily_average) : null;

        // Auto avg computed once; but we need sync value - keep it simple with a cached field on entity later
        // We'll temporarily return with placeholder and fill below (second pass).
        return {
          ...d,
          __tmp_usage: { mode, manualAvg },
          __tmp_latest: latest,
          __tmp_autoAvgPromise: autoAvgPromise,
        };
      });

      return { ...entity, deadlines };
    });

    // Second pass to await auto avg and finalize computed usage deadlines (avoids awaiting inside map)
    for (const entity of computedEntities) {
      const latest = latestUsageByEntity[entity.id] ?? null;
      const autoAvg = await computeAutoDailyAverageFromList(logsByEntity[entity.id] ?? []);

      entity.deadlines = (entity.deadlines ?? []).map((d) => {
        if (!d?.__tmp_usage) return d;

        const mode = d.__tmp_usage.mode as UsageDailyAverageMode;
        const manualAvg = d.__tmp_usage.manualAvg as number | null;

        const computed = computeUsageComputed({
          latestUsage: latest ? Number(latest.value) : null,
          latestLoggedAt: latest ? String(latest.logged_at) : null,
          lastDoneUsage: d?.last_done_usage ?? null,
          frequency: d?.frequency ?? null,
          mode,
          manualAvg,
          autoAvg,
        });

        const cleaned = { ...d };
        delete cleaned.__tmp_usage;
        delete cleaned.__tmp_latest;
        delete cleaned.__tmp_autoAvgPromise;

        return { ...cleaned, computed };
      });

      // helpful: expose entity-level current usage badge
      entity.current_usage = latest ? Number(latest.value) : null;
      entity.current_usage_logged_at = latest ? String(latest.logged_at) : null;
      entity.auto_usage_daily_average = autoAvg ?? null;
    }

    return NextResponse.json({
      meta: { active_org_id: orgId, role: access.role, entity_count_in_org: (entities ?? []).length },
      entities: computedEntities,
      latest_usage_by_entity: latestUsageByEntity,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
