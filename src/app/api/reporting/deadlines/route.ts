import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";
import { isSuperAdmin } from "@/lib/server/superAdmin";

type ReportStatus = "green" | "yellow" | "orange" | "red";

type DeadlineJoinRow = {
  organization_id: string;
  id: string;
  entity_id: string;
  measure_by: "date" | "usage" | null;
  next_due_date: string | null;
  last_done_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  created_at: string;
  entities?: {
    id: string;
    name: string;
    tracks_usage: boolean;
    entity_types?: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
  } | {
    id: string;
    name: string;
    tracks_usage: boolean;
    entity_types?: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
  }[] | null;
  deadline_types?: {
    id: string;
    name: string | null;
    measure_by: "date" | "usage";
  } | {
    id: string;
    name: string | null;
    measure_by: "date" | "usage";
  }[] | null;
};

type LatestUsageRow = {
  entity_id: string;
  value: number;
  logged_at: string;
};

type ReportRow = {
  organization_id: string;
  entity_id: string;
  entity_name: string;
  entity_type_name: string;
  tracks_usage: boolean;
  deadline_id: string;
  deadline_type_name: string;
  measure_by: "date" | "usage";
  status: ReportStatus;
  next_due_date: string | null;
  days_to_due: number | null;
  last_done_date: string | null;
  current_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_remaining: number | null;
  projected_due_date: string | null;
  updated_at: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function unauthorized(message: string) {
  return NextResponse.json({ error: message, code: "UNAUTHORIZED" }, { status: 401 });
}

function daysUntil(dateIso: string, now = new Date()): number | null {
  const due = new Date(dateIso);
  if (!Number.isFinite(due.getTime())) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((due.getTime() - now.getTime()) / msPerDay);
}

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function statusFromDays(
  daysRemaining: number | null,
  thresholds: { yellowDays: number; orangeDays: number; redDays: number }
): ReportStatus {
  if (daysRemaining == null || Number.isNaN(daysRemaining)) return "yellow";
  if (daysRemaining <= 0) return "red";
  if (daysRemaining <= thresholds.orangeDays) return "orange";
  if (daysRemaining <= thresholds.yellowDays) return "yellow";
  return "green";
}

export async function GET(req: Request) {
  try {
    const db = createDataServerClient();
    const url = new URL(req.url);
    const requestedOrgId = (url.searchParams.get("org_id") ?? "").trim();
    const reportingKey = (url.searchParams.get("pbi_key") ?? "").trim();
    const configuredReportingKey = (
      process.env.REPORTING_EXPORT_KEY ??
      process.env.POWERBI_EXPORT_KEY ??
      ""
    ).trim();
    const authHeader = req.headers.get("authorization") || "";
    const hasBearer = authHeader.startsWith("Bearer ");

    let orgId = "";

    if (!hasBearer) {
      // Modo Power BI por URL (sin header Authorization).
      if (!configuredReportingKey) {
        return unauthorized("REPORTING_EXPORT_KEY (or POWERBI_EXPORT_KEY) is not configured");
      }
      if (!reportingKey || reportingKey !== configuredReportingKey) return unauthorized("invalid pbi_key");
      if (!requestedOrgId) {
        return NextResponse.json({ error: "org_id required", code: "BAD_REQUEST" }, { status: 400 });
      }
      orgId = requestedOrgId;
    } else {
      const { user } = await requireAuthUser(req);
      const superAdmin = await isSuperAdmin(db, user.id);
      if (superAdmin) {
        if (!requestedOrgId) {
          return NextResponse.json(
            { error: "org_id required for super admin", code: "BAD_REQUEST" },
            { status: 400 }
          );
        }
        orgId = requestedOrgId;
      } else {
        const access = await getOrgAccess(db, user.id);
        if ("error" in access) {
          return NextResponse.json(
            { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
            { status: access.error === "no active organization" ? 400 : 403 }
          );
        }
        const canReportsUsage = await canViewModule(
          db,
          access.organizationId,
          access.role,
          access.memberTypeId,
          "reports_usage"
        );
        if (!canReportsUsage) {
          return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
        }
        orgId = access.organizationId;
      }
    }

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

    const { data: deadlineData, error: deadlinesErr } = await db
      .from("deadlines")
      .select(
        `
        organization_id,
        id,
        entity_id,
        measure_by,
        next_due_date,
        last_done_date,
        last_done_usage,
        frequency,
        frequency_unit,
        usage_daily_average,
        created_at,
        entities(
          id,
          name,
          tracks_usage,
          entity_types(id, name)
        ),
        deadline_types(id, name, measure_by)
      `
      )
      .eq("organization_id", orgId)
      .eq("is_current", true);
    if (deadlinesErr) throw deadlinesErr;

    const deadlines = (deadlineData ?? []) as DeadlineJoinRow[];
    const entityIds = Array.from(new Set(deadlines.map((d) => d.entity_id)));

    const latestUsageByEntity = new Map<string, { value: number; logged_at: string }>();
    await Promise.all(
      entityIds.map(async (entityId) => {
        const { data, error } = await db
          .from("usage_logs")
          .select("entity_id, value, logged_on, logged_at")
          .eq("organization_id", orgId)
          .eq("entity_id", entityId)
          .not("value", "is", null)
          .order("logged_on", { ascending: false })
          .order("logged_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        const row = (data ?? [])[0] as LatestUsageRow | undefined;
        if (row) latestUsageByEntity.set(entityId, { value: Number(row.value), logged_at: String(row.logged_at) });
      })
    );

    const now = new Date();
    const rows: ReportRow[] = deadlines.map((d) => {
      const entity = pickOne(d.entities);
      const entityType = pickOne(entity?.entity_types ?? null);
      const deadlineType = pickOne(d.deadline_types);
      const measureBy = (deadlineType?.measure_by ?? d.measure_by ?? "date") as "date" | "usage";
      const latestUsage = latestUsageByEntity.get(d.entity_id);

      let status: ReportStatus = "green";
      let nextDueDate: string | null = null;
      let daysToDue: number | null = null;
      let currentUsage: number | null = null;
      let usageRemaining: number | null = null;
      let projectedDueDate: string | null = null;

      if (measureBy === "date") {
        nextDueDate = d.next_due_date ?? null;
        daysToDue = d.next_due_date ? daysUntil(d.next_due_date, now) : null;
        status = statusFromDays(daysToDue, thresholds);
      } else {
        currentUsage = latestUsage?.value ?? null;
        const frequency = d.frequency != null ? Number(d.frequency) : null;
        const lastDoneUsage = d.last_done_usage != null ? Number(d.last_done_usage) : null;
        const avg = d.usage_daily_average != null ? Number(d.usage_daily_average) : null;
        let usageDaysToDue: number | null = null;

        if (currentUsage != null && frequency != null && lastDoneUsage != null) {
          usageRemaining = frequency - (currentUsage - lastDoneUsage);
          if (usageRemaining <= 0) {
            status = "red";
          } else if (avg != null && Number.isFinite(avg) && avg > 0) {
            usageDaysToDue = Math.ceil(usageRemaining / avg);
            status = statusFromDays(usageDaysToDue, thresholds);
          } else {
            // Sin promedio válido no podemos proyectar días; mantenemos advertencia.
            status = "yellow";
          }
        } else {
          usageRemaining = null;
          status = "yellow";
        }

        if (usageRemaining != null && avg != null && Number.isFinite(avg) && avg > 0) {
          const remainingDays = usageRemaining / avg;
          projectedDueDate = addDays(now, remainingDays).toISOString();
        } else {
          projectedDueDate = null;
        }
      }

      return {
        organization_id: d.organization_id,
        entity_id: d.entity_id,
        entity_name: entity?.name ?? "Entidad",
        entity_type_name: entityType?.name ?? "Sin tipo",
        tracks_usage: Boolean(entity?.tracks_usage),
        deadline_id: d.id,
        deadline_type_name: deadlineType?.name ?? "Vencimiento",
        measure_by: measureBy,
        status,
        next_due_date: measureBy === "date" ? nextDueDate : null,
        days_to_due: measureBy === "date" ? daysToDue : null,
        last_done_date: d.last_done_date ?? null,
        current_usage: measureBy === "usage" ? currentUsage : null,
        frequency: measureBy === "usage" ? (d.frequency != null ? Number(d.frequency) : null) : null,
        frequency_unit: measureBy === "usage" ? d.frequency_unit ?? null : null,
        usage_daily_average: measureBy === "usage" ? (d.usage_daily_average != null ? Number(d.usage_daily_average) : null) : null,
        usage_remaining: measureBy === "usage" ? usageRemaining : null,
        projected_due_date: measureBy === "usage" ? projectedDueDate : null,
        updated_at: d.created_at,
      };
    });

    return NextResponse.json(rows);
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
