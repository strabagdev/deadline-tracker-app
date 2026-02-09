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

function toSlugKey(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
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
    const entityTypeId = url.searchParams.get("entity_type_id");
    if (!entityTypeId) return NextResponse.json({ error: "entity_type_id required" }, { status: 400 });

    const { data, error } = await db
      .from("entity_fields")
      .select("id, entity_type_id, name, key, field_type, show_in_card, options, created_at")
      .eq("organization_id", orgId)
      .eq("entity_type_id", entityTypeId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ entity_fields: data ?? [] });
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
    const entityTypeId = String(body?.entity_type_id ?? "").trim();
    const name = String(body?.name ?? "").trim();
    const fieldType = String(body?.field_type ?? "text").trim();
    const showInCard = Boolean(body?.show_in_card ?? false);

    const rawKey = body?.key ? String(body.key) : name;
    const key = toSlugKey(rawKey);

    if (!entityTypeId) return NextResponse.json({ error: "entity_type_id required" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

    const allowed = new Set(["text", "number", "date", "boolean", "select"]);
    if (!allowed.has(fieldType)) {
      return NextResponse.json({ error: "invalid field_type" }, { status: 400 });
    }

    const options = body?.options ?? null;

    const { data, error } = await db
      .from("entity_fields")
      .insert({
        organization_id: orgId,
        entity_type_id: entityTypeId,
        name,
        key,
        field_type: fieldType,
        show_in_card: showInCard,
        options,
      })
      .select("id, entity_type_id, name, key, field_type, show_in_card, options, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ entity_field: data }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
