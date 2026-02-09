import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

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

async function requireEntityInOrg(db: any, orgId: string, entityId: string) {
  const { data, error } = await db
    .from("entities")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw error;
  return !!data?.id;
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

    // Ensure entity belongs to org (avoid leaking IDs)
    const okEntity = await requireEntityInOrg(db, orgId, entityId);
    if (!okEntity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    // Join deadline_types for UI convenience
    const { data, error } = await db
      .from("deadlines")
      .select(
        "id, entity_id, deadline_type_id, last_done_date, next_due_date, last_done_usage, frequency, frequency_unit, usage_daily_average, created_at, deadline_types(id, name, measure_by, requires_document, is_active)"
      )
      .eq("organization_id", orgId)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ deadlines: data ?? [] });
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
    const lastDoneDate = body?.last_done_date ? String(body.last_done_date) : null;

    if (!entityId) return NextResponse.json({ error: "entity_id required" }, { status: 400 });
    if (!deadlineTypeId) return NextResponse.json({ error: "deadline_type_id required" }, { status: 400 });

    const okEntity = await requireEntityInOrg(db, orgId, entityId);
    if (!okEntity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    const dt = await getDeadlineType(db, orgId, deadlineTypeId);
    if (!dt) return NextResponse.json({ error: "deadline type not found" }, { status: 404 });
    if (!dt.is_active) return NextResponse.json({ error: "deadline type is inactive" }, { status: 400 });

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
          last_done_date: lastDoneDate,
          next_due_date: nextDueDate,
        })
        .select("id")
        .single();

      if (error) throw error;
      return NextResponse.json({ id: data?.id }, { status: 201 });
    }

    // usage
    const lastDoneUsage = body?.last_done_usage != null ? Number(body.last_done_usage) : NaN;
    const frequency = body?.frequency != null ? Number(body.frequency) : NaN;
    const frequencyUnit = body?.frequency_unit ? String(body.frequency_unit) : "";
    const usageDailyAverage = body?.usage_daily_average != null ? Number(body.usage_daily_average) : NaN;

    if (!Number.isFinite(lastDoneUsage)) return NextResponse.json({ error: "last_done_usage required" }, { status: 400 });
    if (!Number.isFinite(frequency)) return NextResponse.json({ error: "frequency required" }, { status: 400 });
    if (!frequencyUnit) return NextResponse.json({ error: "frequency_unit required" }, { status: 400 });
    if (!Number.isFinite(usageDailyAverage)) return NextResponse.json({ error: "usage_daily_average required" }, { status: 400 });

    const { data, error } = await db
      .from("deadlines")
      .insert({
        organization_id: orgId,
        entity_id: entityId,
        deadline_type_id: deadlineTypeId,
        last_done_date: lastDoneDate,
        last_done_usage: lastDoneUsage,
        frequency,
        frequency_unit: frequencyUnit,
        usage_daily_average: usageDailyAverage,
      })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ id: data?.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
