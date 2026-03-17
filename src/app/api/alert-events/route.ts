import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";
import { getSemaphoreSettings } from "@/lib/server/semaphoreSettings";

type ForecastRow = {
  organization_id: string;
  entity_id: string;
  deadline_id: string;
  risk_level: "red" | "orange" | "yellow" | "green" | "none";
  days_remaining: number | null;
};

type AlertEventRow = {
  id: string;
  entity_id: string;
  deadline_id: string | null;
  type: string;
  severity: string;
  message: string;
  created_at: string;
  resolved_at: string | null;
};

type EntityRow = {
  id: string;
  name: string | null;
};

type DeadlineRow = {
  id: string;
  is_current: boolean | null;
  deadline_type_id: string | null;
};

type DeadlineTypeRow = {
  id: string;
  name: string | null;
  is_active: boolean | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
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

function severityPriority(level: string) {
  if (level === "red") return 0;
  if (level === "orange") return 1;
  if (level === "yellow") return 2;
  if (level === "green") return 3;
  return 4;
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
    const canAlerts = await canViewModule(db, orgId, access.role, access.memberTypeId, "alerts");
    if (!canAlerts) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const nowIso = new Date().toISOString();
    const EVENT_TYPE = "forecast_risk";
    const semaphore = await getSemaphoreSettings(db, orgId);
    const labels = {
      red: semaphore.labelRed,
      orange: semaphore.labelOrange,
      yellow: semaphore.labelYellow,
    };

    const { data: forecastData, error: forecastErr } = await db
      .from("deadline_forecasts")
      .select("organization_id, entity_id, deadline_id, risk_level, days_remaining")
      .eq("organization_id", orgId);
    if (forecastErr) throw forecastErr;

    const forecasts = (forecastData ?? []) as ForecastRow[];
    const entityIds = Array.from(new Set(forecasts.map((row) => row.entity_id).filter(Boolean)));
    const deadlineIds = Array.from(new Set(forecasts.map((row) => row.deadline_id).filter(Boolean)));

    const [{ data: entitiesData, error: entitiesErr }, { data: deadlinesData, error: deadlinesErr }] = await Promise.all([
      entityIds.length > 0
        ? db.from("entities").select("id, name").eq("organization_id", orgId).in("id", entityIds)
        : Promise.resolve({ data: [], error: null }),
      deadlineIds.length > 0
        ? db.from("deadlines").select("id, is_current, deadline_type_id").eq("organization_id", orgId).in("id", deadlineIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (entitiesErr) throw entitiesErr;
    if (deadlinesErr) throw deadlinesErr;

    const deadlineTypeIds = Array.from(
      new Set(((deadlinesData ?? []) as DeadlineRow[]).map((deadline) => deadline.deadline_type_id).filter(Boolean))
    ) as string[];

    const { data: deadlineTypesData, error: deadlineTypesErr } =
      deadlineTypeIds.length > 0
        ? await db.from("deadline_types").select("id, name, is_active").eq("organization_id", orgId).in("id", deadlineTypeIds)
        : { data: [], error: null };
    if (deadlineTypesErr) throw deadlineTypesErr;

    const entityById = new Map(((entitiesData ?? []) as EntityRow[]).map((entity) => [entity.id, entity]));
    const deadlineById = new Map(((deadlinesData ?? []) as DeadlineRow[]).map((deadline) => [deadline.id, deadline]));
    const deadlineTypeById = new Map(((deadlineTypesData ?? []) as DeadlineTypeRow[]).map((type) => [type.id, type]));

    const candidates = forecasts
      .filter((r) => {
        const deadline = deadlineById.get(r.deadline_id);
        const deadlineType = deadline?.deadline_type_id ? deadlineTypeById.get(deadline.deadline_type_id) : null;
        return Boolean(deadline?.is_current) && deadlineType?.is_active !== false;
      })
      .filter((r) => r.risk_level === "red" || r.risk_level === "orange" || r.risk_level === "yellow")
      .map((r) => {
        const entity = entityById.get(r.entity_id);
        const deadline = deadlineById.get(r.deadline_id);
        const deadlineType = deadline?.deadline_type_id ? deadlineTypeById.get(deadline.deadline_type_id) : null;
        const entityName = entity?.name ?? "Entidad";
        const deadlineName = deadlineType?.name ?? "Vencimiento";
        return {
          organization_id: orgId,
          entity_id: r.entity_id,
          deadline_id: r.deadline_id,
          type: EVENT_TYPE,
          severity: r.risk_level,
          message: eventMessage(entityName, deadlineName, r.risk_level, r.days_remaining, labels),
        };
      });

    const { data: existingData, error: existingErr } = await db
      .from("alert_events")
      .select("id, entity_id, deadline_id, type")
      .eq("organization_id", orgId)
      .is("resolved_at", null)
      .eq("type", EVENT_TYPE);
    if (existingErr) throw existingErr;

    const existing = (existingData ?? []) as Array<{
      id: string;
      entity_id: string;
      deadline_id: string | null;
      type: string;
    }>;
    const existingByKey = new Map(
      existing.map((e) => [`${e.type}|${e.entity_id}|${e.deadline_id ?? ""}`, e])
    );

    const candidateKeys = new Set<string>();
    for (const c of candidates) {
      const key = `${c.type}|${c.entity_id}|${c.deadline_id ?? ""}`;
      candidateKeys.add(key);
      const match = existingByKey.get(key);
      if (match) {
        const { error: upErr } = await db
          .from("alert_events")
          .update({
            severity: c.severity,
            message: c.message,
            resolved_at: null,
          })
          .eq("id", match.id);
        if (upErr) throw upErr;
      } else {
        const { error: insErr } = await db
          .from("alert_events")
          .insert({
            organization_id: c.organization_id,
            entity_id: c.entity_id,
            deadline_id: c.deadline_id,
            type: c.type,
            severity: c.severity,
            message: c.message,
            created_at: nowIso,
            resolved_at: null,
          });
        if (insErr) throw insErr;
      }
    }

    const toResolveIds = existing
      .filter((e) => !candidateKeys.has(`${e.type}|${e.entity_id}|${e.deadline_id ?? ""}`))
      .map((e) => e.id);
    if (toResolveIds.length > 0) {
      const { error: resErr } = await db
        .from("alert_events")
        .update({ resolved_at: nowIso })
        .in("id", toResolveIds);
      if (resErr) throw resErr;
    }

    return NextResponse.json({ ok: true, generated: candidates.length, resolved: toResolveIds.length, computed_at: nowIso });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

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

    const orgId = access.organizationId;
    const canAlerts = await canViewModule(db, orgId, access.role, access.memberTypeId, "alerts");
    if (!canAlerts) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const EVENT_TYPE = "forecast_risk";

    const { data: activeData, error: activeErr } = await db
      .from("alert_events")
      .select("id, entity_id, deadline_id, type, severity, message, created_at, resolved_at")
      .eq("organization_id", orgId)
      .eq("type", EVENT_TYPE)
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (activeErr) throw activeErr;

    const { data: recentResolvedData, error: resolvedErr } = await db
      .from("alert_events")
      .select("id, entity_id, deadline_id, type, severity, message, created_at, resolved_at")
      .eq("organization_id", orgId)
      .eq("type", EVENT_TYPE)
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(50);
    if (resolvedErr) throw resolvedErr;

    const allEvents = [...((activeData ?? []) as AlertEventRow[]), ...((recentResolvedData ?? []) as AlertEventRow[])];
    const entityIds = Array.from(new Set(allEvents.map((event) => event.entity_id).filter(Boolean)));
    const deadlineIds = Array.from(new Set(allEvents.map((event) => event.deadline_id).filter(Boolean))) as string[];

    const [{ data: entitiesData, error: entitiesErr }, { data: deadlinesData, error: deadlinesErr }] = await Promise.all([
      entityIds.length > 0
        ? db.from("entities").select("id, name").eq("organization_id", orgId).in("id", entityIds)
        : Promise.resolve({ data: [], error: null }),
      deadlineIds.length > 0
        ? db.from("deadlines").select("id, deadline_type_id").eq("organization_id", orgId).in("id", deadlineIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (entitiesErr) throw entitiesErr;
    if (deadlinesErr) throw deadlinesErr;

    const deadlineTypeIds = Array.from(
      new Set(((deadlinesData ?? []) as Array<{ id: string; deadline_type_id: string | null }>).map((deadline) => deadline.deadline_type_id).filter(Boolean))
    ) as string[];
    const { data: deadlineTypesData, error: deadlineTypesErr } =
      deadlineTypeIds.length > 0
        ? await db.from("deadline_types").select("id, name").eq("organization_id", orgId).in("id", deadlineTypeIds)
        : { data: [], error: null };
    if (deadlineTypesErr) throw deadlineTypesErr;

    const entityById = new Map(((entitiesData ?? []) as EntityRow[]).map((entity) => [entity.id, entity]));
    const deadlineById = new Map(
      ((deadlinesData ?? []) as Array<{ id: string; deadline_type_id: string | null }>).map((deadline) => [deadline.id, deadline])
    );
    const deadlineTypeById = new Map(((deadlineTypesData ?? []) as Array<{ id: string; name: string | null }>).map((type) => [type.id, type]));

    const active = ((activeData ?? []) as AlertEventRow[]).map((r) => {
      const entity = entityById.get(r.entity_id);
      const deadline = r.deadline_id ? deadlineById.get(r.deadline_id) : null;
      const deadlineType = deadline?.deadline_type_id ? deadlineTypeById.get(deadline.deadline_type_id) : null;
      return {
        id: r.id,
        entity_id: r.entity_id,
        entity_name: entity?.name ?? "Entidad",
        deadline_id: r.deadline_id,
        deadline_name: deadlineType?.name ?? "Vencimiento",
        event_type: r.type,
        severity: r.severity,
        message: r.message,
        first_seen_at: r.created_at,
        last_seen_at: r.created_at,
        resolved_at: r.resolved_at,
      };
    }).sort((a, b) => {
      const pa = severityPriority(a.severity);
      const pb = severityPriority(b.severity);
      if (pa !== pb) return pa - pb;
      return new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime();
    });

    const recent_resolved = (recentResolvedData ?? []).map((r) => ({
      id: String(r.id),
      entity_id: String(r.entity_id),
      deadline_id: r.deadline_id ? String(r.deadline_id) : null,
      event_type: String(r.type),
      severity: String(r.severity),
      message: String(r.message),
      first_seen_at: String(r.created_at),
      last_seen_at: String(r.created_at),
      resolved_at: String(r.resolved_at),
    }));

    return NextResponse.json({
      summary: {
        active: active.length,
        resolved_recent: recent_resolved.length,
      },
      active,
      recent_resolved,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
