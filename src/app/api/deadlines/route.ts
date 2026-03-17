import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import {
  computeDateStatus,
  computeUsageStatus,
  normalizeDeadlinesMode,
} from "@/lib/api/deadlinesComputations";
import {
  handleDeadlinesDelete,
  handleDeadlinesPost,
  handleDeadlinesPut,
  type DeadlinesRepo,
} from "@/lib/api/deadlinesService";
import { syncForecastAndAlertsForEntity } from "@/lib/api/forecastAlertsSync";

type MeasureBy = "date" | "usage";
type DataClient = ReturnType<typeof createDataServerClient>;

type DeadlineTypeRow = {
  id: string;
  name: string;
  measure_by: MeasureBy;
  is_active: boolean;
};

type EntityRow = {
  id: string;
  organization_id: string;
  tracks_usage: boolean;
};

type DeadlineRow = {
  id: string;
  entity_id: string;
  deadline_type_id: string;
  version_group_id?: string | null;
  version_no?: number | null;
  is_current?: boolean;
  superseded_at?: string | null;
  superseded_by_deadline_id?: string | null;
  last_done_date: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_daily_average_mode: string | null;
  created_at: string;
  measure_by?: MeasureBy | null;
};

type DeadlineSnapshot = {
  id: string;
  entity_id: string;
  deadline_type_id: string;
  title: string | null;
  measure_by: MeasureBy | null;
  last_done_date: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_daily_average_mode: string | null;
  version_group_id: string | null;
  version_no: number | null;
};

type DeadlineEventAction = "create" | "update" | "delete";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown };
    if (typeof candidate.message === "string" && candidate.message) return candidate.message;
    if (typeof candidate.details === "string" && candidate.details) return candidate.details;
    if (typeof candidate.hint === "string" && candidate.hint) return candidate.hint;
  }
  return "error";
}

async function getDeadlineSnapshot(db: DataClient, orgId: string, id: string): Promise<DeadlineSnapshot | null> {
  const { data, error } = await db
    .from("deadlines")
    .select(
      "id, entity_id, deadline_type_id, title, measure_by, last_done_date, next_due_date, last_done_usage, frequency, frequency_unit, usage_daily_average, usage_daily_average_mode, version_group_id, version_no"
    )
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as DeadlineSnapshot | null;
}

async function getCurrentDeadlineByEntityAndType(
  db: DataClient,
  orgId: string,
  entityId: string,
  deadlineTypeId: string
): Promise<DeadlineSnapshot | null> {
  const { data, error } = await db
    .from("deadlines")
    .select(
      "id, entity_id, deadline_type_id, title, measure_by, last_done_date, next_due_date, last_done_usage, frequency, frequency_unit, usage_daily_average, usage_daily_average_mode, version_group_id, version_no"
    )
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .eq("deadline_type_id", deadlineTypeId)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data ?? [])[0] ?? null;
  return (row ?? null) as DeadlineSnapshot | null;
}

async function safeLogDeadlineChangeEvent(
  db: DataClient,
  input: {
    organizationId: string;
    deadlineId: string | null;
    entityId: string;
    action: DeadlineEventAction;
    actorUserId: string;
    reason?: string;
    payload: Record<string, unknown>;
  }
) {
  try {
    const { error } = await db.from("deadline_change_events").insert({
      organization_id: input.organizationId,
      deadline_id: input.deadlineId,
      entity_id: input.entityId,
      action: input.action,
      actor_user_id: input.actorUserId,
      reason: input.reason ?? null,
      payload: input.payload,
    });
    if (error) throw error;
  } catch {
    // No bloquear operaciones críticas por fallas del historial.
  }
}

async function getDeadlineType(db: DataClient, orgId: string, deadlineTypeId: string): Promise<DeadlineTypeRow | null> {
  const { data, error } = await db
    .from("deadline_types")
    .select("id, name, measure_by, is_active")
    .eq("organization_id", orgId)
    .eq("id", deadlineTypeId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getEntity(db: DataClient, orgId: string, entityId: string): Promise<EntityRow | null> {
  const { data, error } = await db
    .from("entities")
    .select("id, organization_id, tracks_usage")
    .eq("organization_id", orgId)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getLatestUsage(
  db: DataClient,
  orgId: string,
  entityId: string
): Promise<{ value: number; logged_on: string | null; logged_at: string } | null> {
  const { data, error } = await db
    .from("usage_logs")
    .select("value, logged_on, logged_at")
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .not("value", "is", null)
    .order("logged_on", { ascending: false })
    .order("logged_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) return null;
  return {
    value: Number(row.value),
    logged_on: row.logged_on ? String(row.logged_on) : null,
    logged_at: String(row.logged_at),
  };
}

/**
 * Auto daily average (Option C - hybrid)
 * - Uses the change in usage value over time from recent logs
 * - Looks at up to the last 30 days (or fewer if logs are sparse)
 * - Requires >=2 logs with at least 1 day between min/max logged_at
 */
async function computeAutoDailyAverage(db: DataClient, orgId: string, entityId: string): Promise<number | null> {
  const since = new Date(Date.now() - 30 * MS_PER_DAY).toISOString().slice(0, 10);

  const { data, error } = await db
    .from("usage_logs")
    .select("value, logged_on, logged_at")
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .not("value", "is", null)
    .gte("logged_on", since)
    .order("logged_on", { ascending: true })
    .order("logged_at", { ascending: true })
    .limit(5000);

  if (error) throw error;
  const logs = data ?? [];
  if (logs.length < 2) return null;

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


async function attachComputed(
  db: DataClient,
  orgId: string,
  entityId: string,
  deadline: DeadlineRow,
  deadlineTypeById: Map<string, DeadlineTypeRow>
) {
  const deadlineType = deadlineTypeById.get(deadline.deadline_type_id) ?? null;
  const measureBy = (deadlineType?.measure_by ?? deadline?.measure_by) as MeasureBy | undefined;
  if (!measureBy) return { ...deadline, deadline_types: null, computed: { status: "incomplete", reason: "missing_measure_by" } };

  if (measureBy === "date") {
    return { ...deadline, deadline_types: deadlineType, computed: computeDateStatus(deadline?.next_due_date ?? null) };
  }

  // usage
  const latest = await getLatestUsage(db, orgId, entityId);
  const latestUsage = latest?.value ?? null;

  // Hybrid daily average: manual from deadlines OR auto computed from usage_logs
  const mode = normalizeDeadlinesMode(deadline?.usage_daily_average_mode);
  const manualAvg = Number.isFinite(Number(deadline?.usage_daily_average)) ? Number(deadline.usage_daily_average) : null;

  let effectiveAvg: number | null = null;
  let avgSource: "manual" | "auto" | "none" = "none";

  if (mode === "manual") {
    effectiveAvg = manualAvg;
    avgSource = manualAvg && manualAvg > 0 ? "manual" : "none";
  } else {
    // auto
    const autoAvg = await computeAutoDailyAverage(db, orgId, entityId);
    if (autoAvg && autoAvg > 0) {
      effectiveAvg = autoAvg;
      avgSource = "auto";
    } else if (manualAvg && manualAvg > 0) {
      // fallback: if user entered something even in auto mode, use it as safety net
      effectiveAvg = manualAvg;
      avgSource = "manual";
    }
  }

  const status = computeUsageStatus({
    latestUsage,
    lastDoneUsage: deadline?.last_done_usage ?? null,
    frequency: deadline?.frequency ?? null,
    dailyAverage: effectiveAvg,
  });

  return {
    ...deadline,
    deadline_types: deadlineType,
    computed: {
      ...status,
      current_usage: latestUsage,
      latest_usage_logged_at: latest?.logged_at ?? null,
      daily_average: effectiveAvg,
      daily_average_source: avgSource,
      usage_daily_average_mode: mode,
    },
  };
}

function makeDeadlinesRepo(db: DataClient, actorUserId: string): DeadlinesRepo {
  return {
    getDeadlineById: async (orgId, id) => {
      const { data, error } = await db
        .from("deadlines")
        .select("id, entity_id, deadline_type_id, usage_daily_average_mode, next_due_date")
        .eq("organization_id", orgId)
        .eq("is_current", true)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as {
        id: string;
        entity_id: string;
        deadline_type_id: string;
        usage_daily_average_mode: string | null;
        next_due_date?: string | null;
      } | null;
    },
    getCurrentDeadlineByEntityAndType: async (orgId, entityId, deadlineTypeId) => {
      const row = await getCurrentDeadlineByEntityAndType(db, orgId, entityId, deadlineTypeId);
      if (!row) return null;
      return {
        id: row.id,
        entity_id: row.entity_id,
        deadline_type_id: row.deadline_type_id,
        usage_daily_average_mode: row.usage_daily_average_mode ?? null,
        next_due_date: row.next_due_date ?? null,
      };
    },
    getEntity: async (orgId, entityId) => {
      const entity = await getEntity(db, orgId, entityId);
      if (!entity) return null;
      return { id: entity.id, tracks_usage: entity.tracks_usage };
    },
    getDeadlineType: async (orgId, deadlineTypeId) => {
      const dt = await getDeadlineType(db, orgId, deadlineTypeId);
      if (!dt) return null;
      return { id: dt.id, name: dt.name, measure_by: dt.measure_by, is_active: dt.is_active };
    },
    createDateDeadline: async (orgId, input) => {
      const replaced = await getCurrentDeadlineByEntityAndType(db, orgId, input.entityId, input.deadlineTypeId);
      const versionGroupId = replaced?.version_group_id ? String(replaced.version_group_id) : crypto.randomUUID();
      const versionNo = replaced ? Math.max(1, Number(replaced.version_no ?? 1)) + 1 : 1;
      const { data, error } = await db
        .from("deadlines")
        .insert({
          organization_id: orgId,
          entity_id: input.entityId,
          deadline_type_id: input.deadlineTypeId,
          title: input.legacyTitle,
          measure_by: input.legacyMeasureBy,
          last_done_date: input.lastDoneDate,
          next_due_date: input.nextDueDate,
          version_group_id: versionGroupId,
          version_no: versionNo,
          is_current: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      const createdId = String(data?.id ?? "");
      if (replaced?.id) {
        const { error: replaceErr } = await db
          .from("deadlines")
          .update({
            is_current: false,
            superseded_at: new Date().toISOString(),
            superseded_by_deadline_id: createdId,
          })
          .eq("organization_id", orgId)
          .eq("id", replaced.id);
        if (replaceErr) throw replaceErr;
      }
      await safeLogDeadlineChangeEvent(db, {
        organizationId: orgId,
        deadlineId: createdId,
        entityId: input.entityId,
        action: "create",
        actorUserId,
        payload: {
          source: "api/deadlines",
          mode: "date",
          after: {
            id: createdId,
            entity_id: input.entityId,
            deadline_type_id: input.deadlineTypeId,
            title: input.legacyTitle,
            measure_by: input.legacyMeasureBy,
            last_done_date: input.lastDoneDate,
            next_due_date: input.nextDueDate,
            last_done_usage: null,
            frequency: null,
            frequency_unit: null,
            usage_daily_average: null,
            usage_daily_average_mode: "manual",
          },
          supersedes_deadline_id: replaced?.id ?? null,
        },
      });
      return { id: createdId };
    },
    createUsageDeadline: async (orgId, input) => {
      const replaced = await getCurrentDeadlineByEntityAndType(db, orgId, input.entityId, input.deadlineTypeId);
      const versionGroupId = replaced?.version_group_id ? String(replaced.version_group_id) : crypto.randomUUID();
      const versionNo = replaced ? Math.max(1, Number(replaced.version_no ?? 1)) + 1 : 1;
      const { data, error } = await db
        .from("deadlines")
        .insert({
          organization_id: orgId,
          entity_id: input.entityId,
          deadline_type_id: input.deadlineTypeId,
          title: input.legacyTitle,
          measure_by: input.legacyMeasureBy,
          last_done_date: input.lastDoneDate,
          last_done_usage: input.lastDoneUsage,
          frequency: input.frequency,
          frequency_unit: input.frequencyUnit,
          usage_daily_average_mode: input.mode,
          usage_daily_average: input.usageDailyAverage,
          version_group_id: versionGroupId,
          version_no: versionNo,
          is_current: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      const createdId = String(data?.id ?? "");
      if (replaced?.id) {
        const { error: replaceErr } = await db
          .from("deadlines")
          .update({
            is_current: false,
            superseded_at: new Date().toISOString(),
            superseded_by_deadline_id: createdId,
          })
          .eq("organization_id", orgId)
          .eq("id", replaced.id);
        if (replaceErr) throw replaceErr;
      }
      await safeLogDeadlineChangeEvent(db, {
        organizationId: orgId,
        deadlineId: createdId,
        entityId: input.entityId,
        action: "create",
        actorUserId,
        payload: {
          source: "api/deadlines",
          mode: "usage",
          after: {
            id: createdId,
            entity_id: input.entityId,
            deadline_type_id: input.deadlineTypeId,
            title: input.legacyTitle,
            measure_by: input.legacyMeasureBy,
            last_done_date: input.lastDoneDate,
            next_due_date: null,
            last_done_usage: input.lastDoneUsage,
            frequency: input.frequency,
            frequency_unit: input.frequencyUnit,
            usage_daily_average: input.usageDailyAverage,
            usage_daily_average_mode: input.mode,
          },
          supersedes_deadline_id: replaced?.id ?? null,
        },
      });
      return { id: createdId };
    },
    updateDeadline: async (orgId, id, patch) => {
      const before = await getDeadlineSnapshot(db, orgId, id);
      if (!before) throw new Error("deadline not found");

      const nextVersionNo = Math.max(1, Number(before.version_no ?? 1)) + 1;
      const versionGroupId = String(before.version_group_id ?? before.id);
      const insertPayload = {
        organization_id: orgId,
        entity_id: before.entity_id,
        deadline_type_id: before.deadline_type_id,
        title: before.title,
        measure_by: before.measure_by,
        last_done_date: before.last_done_date,
        next_due_date: before.next_due_date,
        last_done_usage: before.last_done_usage,
        frequency: before.frequency,
        frequency_unit: before.frequency_unit,
        usage_daily_average: before.usage_daily_average,
        usage_daily_average_mode: before.usage_daily_average_mode,
        version_group_id: versionGroupId,
        version_no: nextVersionNo,
        is_current: true,
        ...(patch as Record<string, unknown>),
      };
      const { data: created, error: createErr } = await db
        .from("deadlines")
        .insert(insertPayload)
        .select("id")
        .single();
      if (createErr) throw createErr;
      const newId = String(created?.id ?? "");

      const { error } = await db
        .from("deadlines")
        .update({
          is_current: false,
          superseded_at: new Date().toISOString(),
          superseded_by_deadline_id: newId,
        })
        .eq("organization_id", orgId)
        .eq("id", id);
      if (error) throw error;

      const after = await getDeadlineSnapshot(db, orgId, newId);
      if (after) {
        await safeLogDeadlineChangeEvent(db, {
          organizationId: orgId,
          deadlineId: newId,
          entityId: after.entity_id,
          action: "update",
          actorUserId,
          payload: {
            source: "api/deadlines",
            patch,
            before,
            after,
            supersedes_deadline_id: id,
          },
        });
      }
    },
    deleteDeadline: async (orgId, id) => {
      const before = await getDeadlineSnapshot(db, orgId, id);
      const { error } = await db
        .from("deadlines")
        .update({
          is_current: false,
          superseded_at: new Date().toISOString(),
          superseded_by_deadline_id: null,
        })
        .eq("organization_id", orgId)
        .eq("id", id);
      if (error) throw error;
      if (before) {
        await safeLogDeadlineChangeEvent(db, {
          organizationId: orgId,
          deadlineId: id,
          entityId: before.entity_id,
          action: "delete",
          actorUserId,
          payload: {
            source: "api/deadlines",
            before,
          },
        });
      }
    },
  };
}

/**
 * GET /api/deadlines?entity_id=...
 * Returns deadlines for a single entity, including computed status to avoid duplicating logic in frontend.
 */
export async function GET(req: Request) {
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
    const canEntities = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "entities");
    if (!canEntities) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    const orgId = access.organizationId;

    const url = new URL(req.url);
    const entityId = url.searchParams.get("entity_id");
    const includeHistory = ["1", "true", "yes"].includes(String(url.searchParams.get("include_history") ?? "").toLowerCase());
    if (!entityId) return NextResponse.json({ error: "entity_id required", code: "BAD_REQUEST" }, { status: 400 });

    const entity = await getEntity(db, orgId, entityId);
    if (!entity) return NextResponse.json({ error: "entity not found", code: "ENTITY_NOT_FOUND" }, { status: 404 });

    let query = db
      .from("deadlines")
      .select("id, entity_id, deadline_type_id, version_group_id, version_no, is_current, superseded_at, superseded_by_deadline_id, last_done_date, next_due_date, last_done_usage, frequency, frequency_unit, usage_daily_average, usage_daily_average_mode, created_at")
      .eq("organization_id", orgId)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    if (!includeHistory) query = query.eq("is_current", true);
    const { data, error } = await query;

    if (error) throw error;

    const allDeadlines = (data ?? []) as DeadlineRow[];
    const deadlineTypeIds = Array.from(new Set(allDeadlines.map((d) => d.deadline_type_id).filter(Boolean)));
    const { data: deadlineTypesData, error: deadlineTypesErr } =
      deadlineTypeIds.length > 0
        ? await db
            .from("deadline_types")
            .select("id, name, measure_by, is_active")
            .eq("organization_id", orgId)
            .in("id", deadlineTypeIds)
        : { data: [], error: null };
    if (deadlineTypesErr) throw deadlineTypesErr;
    const deadlineTypeById = new Map(((deadlineTypesData ?? []) as DeadlineTypeRow[]).map((dt) => [dt.id, dt]));

    const currentDeadlines = allDeadlines.filter((d) => d.is_current === true);
    const computedCurrent = await Promise.all(currentDeadlines.map((d) => attachComputed(db, orgId, entityId, d, deadlineTypeById)));
    if (!includeHistory) {
      return NextResponse.json({ entity: { id: entity.id, tracks_usage: entity.tracks_usage }, deadlines: computedCurrent });
    }
    const computedHistory = await Promise.all(allDeadlines.map((d) => attachComputed(db, orgId, entityId, d, deadlineTypeById)));

    return NextResponse.json({
      entity: { id: entity.id, tracks_usage: entity.tracks_usage },
      deadlines: computedCurrent,
      history: computedHistory,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
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
    const canEntities = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "entities");
    if (!canEntities || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const response = await handleDeadlinesPost(access.organizationId, body, makeDeadlinesRepo(db, user.id));
    const entityId = typeof response.body?.entity_id === "string" ? response.body.entity_id : "";
    if (response.status < 400 && entityId) {
      try {
        await syncForecastAndAlertsForEntity(db, access.organizationId, entityId);
      } catch (syncErr: unknown) {
        return NextResponse.json(
          {
            ...response.body,
            sync_warning: getErrorMessage(syncErr),
          },
          { status: response.status }
        );
      }
    }
    return NextResponse.json(response.body, { status: response.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
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
    const canEntities = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "entities");
    if (!canEntities || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const response = await handleDeadlinesPut(access.organizationId, body, makeDeadlinesRepo(db, user.id));
    const entityId = typeof response.body?.entity_id === "string" ? response.body.entity_id : "";
    if (response.status < 400 && entityId) {
      try {
        await syncForecastAndAlertsForEntity(db, access.organizationId, entityId);
      } catch (syncErr: unknown) {
        return NextResponse.json(
          {
            ...response.body,
            sync_warning: getErrorMessage(syncErr),
          },
          { status: response.status }
        );
      }
    }
    return NextResponse.json(response.body, { status: response.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
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
    const canEntities = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "entities");
    if (!canEntities || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    const response = await handleDeadlinesDelete(access.organizationId, id, makeDeadlinesRepo(db, user.id));
    const entityId = typeof response.body?.entity_id === "string" ? response.body.entity_id : "";
    if (response.status < 400 && entityId) {
      try {
        await syncForecastAndAlertsForEntity(db, access.organizationId, entityId);
      } catch (syncErr: unknown) {
        return NextResponse.json(
          {
            ...response.body,
            sync_warning: getErrorMessage(syncErr),
          },
          { status: response.status }
        );
      }
    }
    return NextResponse.json(response.body, { status: response.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
