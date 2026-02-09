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

    const url = new URL(req.url);
    const entityId = url.searchParams.get("entity_id");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 10) || 10, 50);

    if (!entityId) return NextResponse.json({ error: "entity_id required" }, { status: 400 });

    const { data, error } = await db
      .from("usage_logs")
      .select("id, value, logged_at")
      .eq("organization_id", orgId)
      .eq("entity_id", entityId)
      .order("logged_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return NextResponse.json({ usage_logs: data ?? [] });
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
    const value = body?.value != null ? Number(body.value) : NaN;
    const loggedAt = body?.logged_at ? String(body.logged_at) : null;

    if (!entityId) return NextResponse.json({ error: "entity_id required" }, { status: 400 });
    if (!Number.isFinite(value)) return NextResponse.json({ error: "value must be a number" }, { status: 400 });

    const insertRow: any = { organization_id: orgId, entity_id: entityId, value };
    if (loggedAt) insertRow.logged_at = loggedAt;

    const { data, error } = await db.from("usage_logs").insert(insertRow).select("id").single();
    if (error) throw error;

    return NextResponse.json({ id: data?.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
