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

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    // Diagnostic count
    const { count: entityCount, error: countErr } = await db
      .from("entities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);
    if (countErr) throw countErr;

    // Entities + deadlines + type
    const { data: entities, error: entErr } = await db
      .from("entities")
      .select(
        `
        id,
        name,
        created_at,
        entity_type_id,
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
          created_at,
          deadline_types(id, name, measure_by, requires_document, is_active)
        )
      `
      )
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (entErr) throw entErr;

    const entityIds = (entities ?? []).map((e: any) => e.id);

    // IMPORTANT: your schema uses usage_logs.logged_at (NOT recorded_at / created_at)
    const latestUsageByEntity: Record<string, { value: number; logged_at: string }> = {};

    if (entityIds.length > 0) {
      const { data: logs, error: logErr } = await db
        .from("usage_logs")
        .select("entity_id, value, logged_at")
        .in("entity_id", entityIds)
        .order("logged_at", { ascending: false })
        .limit(5000);

      if (logErr) throw logErr;

      for (const row of logs ?? []) {
        const id = row.entity_id as string;
        if (!latestUsageByEntity[id]) {
          latestUsageByEntity[id] = {
            value: Number(row.value),
            logged_at: row.logged_at as string,
          };
        }
      }
    }

    return NextResponse.json({
      meta: {
        active_org_id: orgId,
        role,
        entity_count_in_org: entityCount ?? 0,
      },
      entities: entities ?? [],
      latest_usage_by_entity: latestUsageByEntity,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
