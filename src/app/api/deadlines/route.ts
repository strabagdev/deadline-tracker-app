import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";
import {
  computeDateStatus,
  computeUsageStatus,
  normalizeDeadlinesMode,
  numOrNaN,
} from "@/lib/api/deadlinesComputations";
import { handleDeadlinesPost, type DeadlinesRepo } from "@/lib/api/deadlinesService";

type MeasureBy = "date" | "usage";
type DataClient = ReturnType<typeof createDataServerClient>;

type DeadlineTypeRow = {
  id: string;
  name: string;
  measure_by: MeasureBy;
  requires_document: boolean;
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
  last_done_date: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_daily_average_mode: string | null;
  created_at: string;
  deadline_types?: DeadlineTypeRow | null;
  measure_by?: MeasureBy | null;
};

type ExistingDeadlineRow = {
  id: string;
  entity_id: string;
  deadline_type_id: string;
  usage_daily_average_mode: string | null;
  deadline_types?: DeadlineTypeRow | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}


async function getDeadlineType(db: DataClient, orgId: string, deadlineTypeId: string): Promise<DeadlineTypeRow | null> {
  const { data, error } = await db
    .from("deadline_types")
    .select("id, name, measure_by, requires_document, is_active")
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

async function getLatestUsage(db: DataClient, orgId: string, entityId: string): Promise<{ value: number; logged_at: string } | null> {
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
  return { value: Number(row.value), logged_at: String(row.logged_at) };
}

/**
 * Auto daily average (Option C - hybrid)
 * - Uses the change in usage value over time from recent logs
 * - Looks at up to the last 30 days (or fewer if logs are sparse)
 * - Requires >=2 logs with at least 1 day between min/max logged_at
 */
async function computeAutoDailyAverage(db: DataClient, orgId: string, entityId: string): Promise<number | null> {
  const since = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();

  const { data, error } = await db
    .from("usage_logs")
    .select("value, logged_at")
    .eq("organization_id", orgId)
    .eq("entity_id", entityId)
    .gte("logged_at", since)
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


async function attachComputed(db: DataClient, orgId: string, entityId: string, deadline: DeadlineRow) {
  const measureBy = (deadline?.deadline_types?.measure_by ?? deadline?.measure_by) as MeasureBy | undefined;
  if (!measureBy) return { ...deadline, computed: { status: "incomplete", reason: "missing_measure_by" } };

  if (measureBy === "date") {
    return { ...deadline, computed: computeDateStatus(deadline?.next_due_date ?? null) };
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

function makeDeadlinesRepo(db: DataClient): DeadlinesRepo {
  return {
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
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: String(data?.id ?? "") };
    },
    createUsageDeadline: async (orgId, input) => {
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
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: String(data?.id ?? "") };
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
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const orgId = access.organizationId;

    const url = new URL(req.url);
    const entityId = url.searchParams.get("entity_id");
    if (!entityId) return NextResponse.json({ error: "entity_id required" }, { status: 400 });

    const entity = await getEntity(db, orgId, entityId);
    if (!entity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    const { data, error } = await db
      .from("deadlines")
      .select(
        `
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
      `
      )
      .eq("organization_id", orgId)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const computed = await Promise.all(((data ?? []) as DeadlineRow[]).map((d) => attachComputed(db, orgId, entityId, d)));

    return NextResponse.json({ entity: { id: entity.id, tracks_usage: entity.tracks_usage }, deadlines: computed });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const body = await req.json().catch(() => ({}));
    const response = await handleDeadlinesPost(access.organizationId, body, makeDeadlinesRepo(db));
    return NextResponse.json(response.body, { status: response.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const orgId = access.organizationId;

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { data: existing, error: exErr } = await db
      .from("deadlines")
      .select(
        `
        id,
        entity_id,
        deadline_type_id,
        usage_daily_average_mode,
        deadline_types(id, name, measure_by, requires_document, is_active)
      `
      )
      .eq("organization_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (exErr) throw exErr;
    const existingRow = existing as ExistingDeadlineRow | null;
    if (!existingRow) return NextResponse.json({ error: "not found" }, { status: 404 });

    const entity = await getEntity(db, orgId, existingRow.entity_id);
    if (!entity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    const dt = await getDeadlineType(db, orgId, existingRow.deadline_type_id);
    if (!dt) return NextResponse.json({ error: "deadline type not found" }, { status: 404 });

    const measureBy = dt.measure_by as MeasureBy;

    const patch: Record<string, string | number | null> = {
      // legacy columns
      title: dt.name,
      measure_by: measureBy,
    };

    const lastDoneDate = body?.last_done_date !== undefined ? (body?.last_done_date ? String(body.last_done_date) : null) : undefined;
    if (lastDoneDate !== undefined) patch.last_done_date = lastDoneDate;

    if (measureBy === "date") {
      const nextDueDate =
        body?.next_due_date !== undefined ? (body?.next_due_date ? String(body.next_due_date) : null) : undefined;

      if (nextDueDate !== undefined && !nextDueDate) {
        return NextResponse.json({ error: "next_due_date required for type measure_by=date" }, { status: 400 });
      }
      if (nextDueDate !== undefined) patch.next_due_date = nextDueDate;

      // ensure usage fields are null-ish when editing date-based (keeps data clean but doesn't break older rows)
      patch.last_done_usage = null;
      patch.frequency = null;
      patch.frequency_unit = null;
      patch.usage_daily_average = null;
      // Column is NOT NULL in DB; keep a valid sentinel mode for date-based deadlines.
      patch.usage_daily_average_mode = "manual";

      const { error } = await db.from("deadlines").update(patch).eq("organization_id", orgId).eq("id", id);
      if (error) throw error;

      return NextResponse.json({ ok: true });
    }

    // usage
    if (!entity.tracks_usage) {
      return NextResponse.json(
        { error: "entity does not track usage; cannot update a usage-based deadline", code: "TRACKS_USAGE_FALSE" },
        { status: 400 }
      );
    }

    const mode =
      body?.usage_daily_average_mode !== undefined
        ? normalizeDeadlinesMode(body?.usage_daily_average_mode)
        : normalizeDeadlinesMode(existingRow.usage_daily_average_mode);

    const lastDoneUsage = body?.last_done_usage !== undefined ? numOrNaN(body?.last_done_usage) : NaN;
    const frequency = body?.frequency !== undefined ? numOrNaN(body?.frequency) : NaN;
    const frequencyUnit = body?.frequency_unit !== undefined ? (body?.frequency_unit ? String(body.frequency_unit) : "") : undefined;
    const usageDailyAverage = body?.usage_daily_average !== undefined ? numOrNaN(body?.usage_daily_average) : NaN;

    if (body?.last_done_usage !== undefined && !Number.isFinite(lastDoneUsage))
      return NextResponse.json({ error: "last_done_usage must be a number" }, { status: 400 });
    if (body?.frequency !== undefined && !Number.isFinite(frequency))
      return NextResponse.json({ error: "frequency must be a number" }, { status: 400 });
    if (body?.frequency_unit !== undefined && !frequencyUnit)
      return NextResponse.json({ error: "frequency_unit required" }, { status: 400 });

    if (mode === "manual" && body?.usage_daily_average_mode !== undefined) {
      // if user explicitly switches to manual, require avg on the same request
      if (!Number.isFinite(usageDailyAverage) || usageDailyAverage <= 0) {
        return NextResponse.json(
          { error: "usage_daily_average required when switching to usage_daily_average_mode=manual" },
          { status: 400 }
        );
      }
    }

    patch.usage_daily_average_mode = mode;

    if (body?.last_done_usage !== undefined) patch.last_done_usage = lastDoneUsage;
    if (body?.frequency !== undefined) patch.frequency = frequency;
    if (body?.frequency_unit !== undefined) patch.frequency_unit = frequencyUnit;
    if (body?.usage_daily_average !== undefined)
      patch.usage_daily_average = Number.isFinite(usageDailyAverage) && usageDailyAverage > 0 ? usageDailyAverage : null;

    const { error } = await db.from("deadlines").update(patch).eq("organization_id", orgId).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const orgId = access.organizationId;

    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { error } = await db.from("deadlines").delete().eq("organization_id", orgId).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
