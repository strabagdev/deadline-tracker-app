import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";
import { parseUsageLogsCreateBody, parseUsageLogsGetParams } from "@/lib/api/usageLogsInput";

type DataClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

async function requireEntityInOrg(db: DataClient, orgId: string, entityId: string) {
  const { data, error } = await db
    .from("entities")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", entityId)
    .maybeSingle();
  if (error) throw error;
  return !!data?.id;
}

async function getUsageLogById(db: DataClient, orgId: string, id: string) {
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
    const parsed = parseUsageLogsGetParams(url);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { entityId, limit } = parsed;

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
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
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
    const parsed = parseUsageLogsCreateBody(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const { entityId, value, loggedAt } = parsed;

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
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
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
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
