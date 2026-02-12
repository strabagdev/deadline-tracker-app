import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

type MeasureBy = "date" | "usage";
type UsageDailyAverageMode = "manual" | "auto";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeMode(val: any): UsageDailyAverageMode {
  const s = String(val ?? "").trim().toLowerCase();
  return s === "auto" ? "auto" : "manual";
}

function numOrNaN(v: any) {
  if (v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
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

async function getActiveOrgId(db: any, userId: string) {
  const { data, error } = await db
    .from("user_settings")
    .select("active_organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data?.active_organization_id as string) || null;
}

async function requireMember(db: any, organizationId: string, userId: string) {
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role ?? null;
}

async function getDeadlineType(db: any, orgId: string, deadlineTypeId: string) {
  const { data, error } = await db
    .from("deadline_types")
    .select("id, name, measure_by, requires_document, is_active")
    .eq("organization_id", orgId)
    .eq("id", deadlineTypeId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getEntity(db: any, orgId: string, entityId: string) {
  const { data, error } = await db
    .from("entities")
    .select("id, organization_id, tracks_usage")
    .eq("organization_id", orgId)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getLatestUsage(db: any, orgId: string, entityId: string): Promise<{ value: number; logged_at: string } | null> {
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
async function computeAutoDailyAverage(db: any, orgId: string, entityId: string): Promise<number | null> {
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

function computeUsageStatus(args: {
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

  // If remaining is <= 0 => expired
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

function computeDateStatus(nextDueDate: string | null) {
  if (!nextDueDate) return { status: "incomplete" as const, reason: "missing_next_due_date" as const };
  const daysToDue = daysDiffFromNowISO(nextDueDate);
  return {
    status: "ok" as const,
    days_to_due: daysToDue,
    semaphore: semaphoreFromDays(daysToDue),
  };
}

async function attachComputed(db: any, orgId: string, entityId: string, deadline: any) {
  const measureBy = (deadline?.deadline_types?.measure_by ?? deadline?.measure_by) as MeasureBy | undefined;
  if (!measureBy) return { ...deadline, computed: { status: "incomplete", reason: "missing_measure_by" } };

  if (measureBy === "date") {
    return { ...deadline, computed: computeDateStatus(deadline?.next_due_date ?? null) };
  }

  // usage
  const latest = await getLatestUsage(db, orgId, entityId);
  const latestUsage = latest?.value ?? null;

  // Hybrid daily average: manual from deadlines OR auto computed from usage_logs
  const mode = normalizeMode(deadline?.usage_daily_average_mode);
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

/**
 * GET /api/deadlines?entity_id=...
 * Returns deadlines for a single entity, including computed status to avoid duplicating logic in frontend.
 */
export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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

    const computed = await Promise.all((data ?? []).map((d: any) => attachComputed(db, orgId, entityId, d)));

    return NextResponse.json({ entity: { id: entity.id, tracks_usage: entity.tracks_usage }, deadlines: computed });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));

    const entityId = String(body?.entity_id ?? "").trim();
    const deadlineTypeId = String(body?.deadline_type_id ?? "").trim();

    if (!entityId) return NextResponse.json({ error: "entity_id required" }, { status: 400 });
    if (!deadlineTypeId) return NextResponse.json({ error: "deadline_type_id required" }, { status: 400 });

    const entity = await getEntity(db, orgId, entityId);
    if (!entity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    const dt = await getDeadlineType(db, orgId, deadlineTypeId);
    if (!dt) return NextResponse.json({ error: "deadline type not found" }, { status: 404 });
    if (!dt.is_active) return NextResponse.json({ error: "deadline type is inactive" }, { status: 400 });

    const lastDoneDate = body?.last_done_date ? String(body.last_done_date) : null;

    // Backward compat for legacy columns (some schemas still have deadlines.title/measure_by NOT NULL)
    const legacyTitle = dt.name;
    const legacyMeasureBy = dt.measure_by as MeasureBy;

    if (dt.measure_by === "date") {
      const nextDueDate = body?.next_due_date ? String(body.next_due_date) : null;
      if (!nextDueDate) {
        return NextResponse.json({ error: "next_due_date required for type measure_by=date" }, { status: 400 });
      }

      const { data, error } = await db
        .from("deadlines")
        .insert({
          organization_id: orgId,
          entity_id: entityId,
          deadline_type_id: deadlineTypeId,
          // legacy
          title: legacyTitle,
          measure_by: legacyMeasureBy,
          // fields
          last_done_date: lastDoneDate,
          next_due_date: nextDueDate,
        })
        .select("id")
        .single();

      if (error) throw error;
      return NextResponse.json({ id: data?.id }, { status: 201 });
    }

    // usage
    if (!entity.tracks_usage) {
      return NextResponse.json(
        { error: "entity does not track usage; cannot create a usage-based deadline", code: "TRACKS_USAGE_FALSE" },
        { status: 400 }
      );
    }

    const mode = normalizeMode(body?.usage_daily_average_mode);
    const lastDoneUsage = numOrNaN(body?.last_done_usage);
    const frequency = numOrNaN(body?.frequency);
    const frequencyUnit = body?.frequency_unit ? String(body.frequency_unit) : "";
    const usageDailyAverage = numOrNaN(body?.usage_daily_average);

    if (!Number.isFinite(lastDoneUsage)) return NextResponse.json({ error: "last_done_usage required" }, { status: 400 });
    if (!Number.isFinite(frequency)) return NextResponse.json({ error: "frequency required" }, { status: 400 });
    if (!frequencyUnit) return NextResponse.json({ error: "frequency_unit required" }, { status: 400 });

    if (mode === "manual") {
      if (!Number.isFinite(usageDailyAverage) || usageDailyAverage <= 0) {
        return NextResponse.json(
          { error: "usage_daily_average required for usage_daily_average_mode=manual" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await db
      .from("deadlines")
      .insert({
        organization_id: orgId,
        entity_id: entityId,
        deadline_type_id: deadlineTypeId,
        // legacy
        title: legacyTitle,
        measure_by: legacyMeasureBy,
        // fields
        last_done_date: lastDoneDate,
        last_done_usage: lastDoneUsage,
        frequency,
        frequency_unit: frequencyUnit,
        usage_daily_average_mode: mode,
        // Hybrid: for auto we keep NULL unless a fallback is provided
        usage_daily_average: Number.isFinite(usageDailyAverage) && usageDailyAverage > 0 ? usageDailyAverage : null,
      })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ id: data?.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

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
    if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

    const entity = await getEntity(db, orgId, existing.entity_id);
    if (!entity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    const dt = await getDeadlineType(db, orgId, existing.deadline_type_id);
    if (!dt) return NextResponse.json({ error: "deadline type not found" }, { status: 404 });

    const measureBy = dt.measure_by as MeasureBy;

    const patch: any = {
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
      patch.usage_daily_average_mode = null;

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

    const mode = body?.usage_daily_average_mode !== undefined ? normalizeMode(body?.usage_daily_average_mode) : normalizeMode(existing.usage_daily_average_mode);

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
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { error } = await db.from("deadlines").delete().eq("organization_id", orgId).eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
