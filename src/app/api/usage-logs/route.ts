import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";

function numOrNaN(v: any) {
  if (v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
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

async function getUsageLogById(db: any, orgId: string, id: string) {
  const { data, error } = await db
    .from("usage_logs")
    .select("id, organization_id, entity_id")
    .eq("organization_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/**
 * GET /api/usage-logs?entity_id=...&limit=10
 */
export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const orgId = access.organizationId;

    const url = new URL(req.url);
    const entityId = String(url.searchParams.get("entity_id") ?? "").trim();
    const limit = Math.min(Math.max(parseInt(String(url.searchParams.get("limit") ?? "10"), 10) || 10, 1), 100);

    if (!entityId) return NextResponse.json({ error: "entity_id required" }, { status: 400 });

    const okEntity = await requireEntityInOrg(db, orgId, entityId);
    if (!okEntity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    const { data, error } = await db
      .from("usage_logs")
      .select("id, entity_id, value, logged_at")
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

/**
 * POST /api/usage-logs
 * body: { entity_id, value, logged_at? }
 */
export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const orgId = access.organizationId;

    const body = await req.json().catch(() => ({}));

    const entityId = String(body?.entity_id ?? "").trim();
    const value = numOrNaN(body?.value);
    const loggedAt = body?.logged_at ? String(body.logged_at) : new Date().toISOString();

    if (!entityId) return NextResponse.json({ error: "entity_id required" }, { status: 400 });
    if (!Number.isFinite(value)) return NextResponse.json({ error: "value required" }, { status: 400 });

    const okEntity = await requireEntityInOrg(db, orgId, entityId);
    if (!okEntity) return NextResponse.json({ error: "entity not found" }, { status: 404 });

    const { data, error } = await db
      .from("usage_logs")
      .insert({
        organization_id: orgId,
        entity_id: entityId,
        value,
        logged_at: loggedAt,
      })
      .select("id")
      .single();

    if (error) throw error;
    return NextResponse.json({ id: data?.id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

/**
 * DELETE /api/usage-logs?id=...
 */
export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }
    const orgId = access.organizationId;

    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const existing = await getUsageLogById(db, orgId, id);
    if (!existing) return NextResponse.json({ error: "usage log not found" }, { status: 404 });

    const { error } = await db
      .from("usage_logs")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
