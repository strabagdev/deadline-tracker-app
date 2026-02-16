import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";
import {
  handleUsageLogsDelete,
  handleUsageLogsGet,
  handleUsageLogsPost,
  type UsageLogsRepo,
} from "@/lib/api/usageLogsService";

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

function makeRepo(db: DataClient): UsageLogsRepo {
  return {
    requireEntityInOrg: (orgId, entityId) => requireEntityInOrg(db, orgId, entityId),
    listUsageLogs: async (orgId, entityId, limit) => {
      const { data, error } = await db
        .from("usage_logs")
        .select("id, entity_id, value, logged_at")
        .eq("organization_id", orgId)
        .eq("entity_id", entityId)
        .order("logged_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data ?? [];
    },
    createUsageLog: async (orgId, entityId, value, loggedAt) => {
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
      return { id: String(data?.id ?? "") };
    },
    getUsageLogById: (orgId, id) => getUsageLogById(db, orgId, id),
    deleteUsageLog: async (orgId, id) => {
      const { error } = await db
        .from("usage_logs")
        .delete()
        .eq("organization_id", orgId)
        .eq("id", id);
      if (error) throw error;
    },
  };
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
    const response = await handleUsageLogsGet(access.organizationId, req.url, makeRepo(db));
    return NextResponse.json(response.body, { status: response.status });
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
    const body = await req.json().catch(() => ({}));
    const response = await handleUsageLogsPost(access.organizationId, body, makeRepo(db));
    return NextResponse.json(response.body, { status: response.status });
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
    const response = await handleUsageLogsDelete(access.organizationId, req.url, makeRepo(db));
    return NextResponse.json(response.body, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
