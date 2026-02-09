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

    const url = new URL(req.url);
    const onlyActive = url.searchParams.get("active") === "1";

    let q = db
      .from("deadline_types")
      .select("id, name, measure_by, requires_document, is_active, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (onlyActive) q = q.eq("is_active", true);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ deadline_types: data ?? [] });
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
    if (!isAdminRole(role)) return NextResponse.json({ error: "admin required" }, { status: 403 });

    const body = await req.json().catch(() => ({}));

    const name = String(body?.name ?? "").trim();
    const measureBy = String(body?.measure_by ?? "").trim(); // date|usage
    const requiresDocument = Boolean(body?.requires_document ?? false);

    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (measureBy !== "date" && measureBy !== "usage") {
      return NextResponse.json({ error: "measure_by must be 'date' or 'usage'" }, { status: 400 });
    }

    const { data, error } = await db
      .from("deadline_types")
      .insert({
        organization_id: orgId,
        name,
        measure_by: measureBy,
        requires_document: requiresDocument,
        is_active: true,
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
    if (!isAdminRole(role)) return NextResponse.json({ error: "admin required" }, { status: 403 });

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const patch: any = {};

    if (body?.name != null) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
      patch.name = name;
    }

    if (body?.measure_by != null) {
      const measureBy = String(body.measure_by).trim();
      if (measureBy !== "date" && measureBy !== "usage") {
        return NextResponse.json({ error: "measure_by must be 'date' or 'usage'" }, { status: 400 });
      }
      patch.measure_by = measureBy;
    }

    if (body?.requires_document != null) patch.requires_document = Boolean(body.requires_document);
    if (body?.is_active != null) patch.is_active = Boolean(body.is_active);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no fields to update" }, { status: 400 });
    }

    const { error } = await db
      .from("deadline_types")
      .update(patch)
      .eq("organization_id", orgId)
      .eq("id", id);

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
    if (!isAdminRole(role)) return NextResponse.json({ error: "admin required" }, { status: 403 });

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // soft delete (deactivate)
    const { error } = await db
      .from("deadline_types")
      .update({ is_active: false })
      .eq("organization_id", orgId)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
