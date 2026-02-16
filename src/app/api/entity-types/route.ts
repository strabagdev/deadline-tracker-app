import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataServerClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

async function getActiveOrgId(db: DataServerClient, userId: string) {
  const { data, error } = await db
    .from("user_settings")
    .select("active_organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.active_organization_id as string) || null;
}

async function requireMember(db: DataServerClient, organizationId: string, userId: string) {
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role ?? null;
}

function isAdminRole(role: string | null) {
  return role === "owner" || role === "admin";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const { data, error } = await db
      .from("entity_types")
      .select("id, name, icon, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ entity_types: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!isAdminRole(role)) return NextResponse.json({ error: "admin required" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const icon = body?.icon ? String(body.icon).trim() : null;

    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const { data, error } = await db
      .from("entity_types")
      .insert({ organization_id: orgId, name, icon })
      .select("id, name, icon, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ entity_type: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
