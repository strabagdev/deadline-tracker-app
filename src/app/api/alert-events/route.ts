import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";

type ForecastRow = {
  organization_id: string;
  entity_id: string;
  deadline_id: string;
  risk_level: "red" | "orange" | "yellow" | "green" | "none";
  days_remaining: number | null;
  entities?: { name: string | null } | { name: string | null }[] | null;
  deadlines?:
    | { is_current?: boolean | null; deadline_types?: { name: string | null; is_active?: boolean | null } | { name: string | null; is_active?: boolean | null }[] | null }
    | { is_current?: boolean | null; deadline_types?: { name: string | null; is_active?: boolean | null } | { name: string | null; is_active?: boolean | null }[] | null }[]
    | null;
};

type AlertEventRow = {
  id: string;
  entity_id: string;
  deadline_id: string | null;
  event_type: string;
  severity: string;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  entities?: { name: string | null } | { name: string | null }[] | null;
  deadlines?:
    | { deadline_types?: { name: string | null } | { name: string | null }[] | null }
    | { deadline_types?: { name: string | null } | { name: string | null }[] | null }[]
    | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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
    const { data: settingsData, error: settingsErr } = await db
      .from("organization_settings")
      .select("label_red, label_orange, label_yellow")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (settingsErr) throw settingsErr;
    const labels = {
      red: String(settingsData?.label_red ?? "Vencido"),
      orange: String(settingsData?.label_orange ?? "Por vencer"),
      yellow: String(settingsData?.label_yellow ?? "Aviso"),
    };

    const { data: forecastData, error: forecastErr } = await db
      .from("deadline_forecasts")
      .select(
        `
        organization_id,
        entity_id,
        deadline_id,
        risk_level,
        days_remaining,
        entities(name),
        deadlines(is_current, deadline_types(name, is_active))
      `
      )
      .eq("organization_id", orgId);
    if (forecastErr) throw forecastErr;

    const candidates = ((forecastData ?? []) as ForecastRow[])
      .filter((r) => {
        const deadline = pickOne(r.deadlines);
        const deadlineType = pickOne(deadline?.deadline_types ?? null);
        return Boolean(deadline?.is_current) && deadlineType?.is_active !== false;
      })
      .filter((r) => r.risk_level === "red" || r.risk_level === "orange" || r.risk_level === "yellow")
      .map((r) => {
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

    const { data: existingData, error: existingErr } = await db
      .from("alert_events")
      .select("id, entity_id, deadline_id, event_type")
      .eq("organization_id", orgId)
      .is("resolved_at", null)
      .eq("event_type", EVENT_TYPE);
    if (existingErr) throw existingErr;

    const existing = (existingData ?? []) as Array<{
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
        const { error: insErr } = await db
          .from("alert_events")
          .insert({
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
      .select(
        `
        id,
        entity_id,
        deadline_id,
        event_type,
        severity,
        message,
        first_seen_at,
        last_seen_at,
        resolved_at,
        entities(name),
        deadlines(deadline_types(name))
      `
      )
      .eq("organization_id", orgId)
      .eq("event_type", EVENT_TYPE)
      .is("resolved_at", null)
      .order("last_seen_at", { ascending: false })
      .limit(200);
    if (activeErr) throw activeErr;

    const { data: recentResolvedData, error: resolvedErr } = await db
      .from("alert_events")
      .select("id, entity_id, deadline_id, event_type, severity, message, first_seen_at, last_seen_at, resolved_at")
      .eq("organization_id", orgId)
      .eq("event_type", EVENT_TYPE)
      .not("resolved_at", "is", null)
      .order("resolved_at", { ascending: false })
      .limit(50);
    if (resolvedErr) throw resolvedErr;

    const active = ((activeData ?? []) as AlertEventRow[]).map((r) => {
      const entity = pickOne(r.entities);
      const deadline = pickOne(r.deadlines);
      const deadlineType = pickOne(deadline?.deadline_types ?? null);
      return {
        id: r.id,
        entity_id: r.entity_id,
        entity_name: entity?.name ?? "Entidad",
        deadline_id: r.deadline_id,
        deadline_name: deadlineType?.name ?? "Vencimiento",
        event_type: r.event_type,
        severity: r.severity,
        message: r.message,
        first_seen_at: r.first_seen_at,
        last_seen_at: r.last_seen_at,
        resolved_at: r.resolved_at,
      };
    }).sort((a, b) => {
      const pa = severityPriority(a.severity);
      const pb = severityPriority(b.severity);
      if (pa !== pb) return pa - pb;
      return new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
    });

    const recent_resolved = (recentResolvedData ?? []).map((r) => ({
      id: String(r.id),
      entity_id: String(r.entity_id),
      deadline_id: r.deadline_id ? String(r.deadline_id) : null,
      event_type: String(r.event_type),
      severity: String(r.severity),
      message: String(r.message),
      first_seen_at: String(r.first_seen_at),
      last_seen_at: String(r.last_seen_at),
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
