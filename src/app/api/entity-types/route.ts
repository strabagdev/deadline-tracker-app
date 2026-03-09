import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canEntityTypes = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "entity_types"
    );
    if (!canEntityTypes) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const { data, error } = await db
      .from("entity_types")
      .select("id, name, icon, created_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ entity_types: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canEntityTypes = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "entity_types"
    );
    if (!canEntityTypes || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const icon = body?.icon ? String(body.icon).trim() : null;

    if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });

    const { data, error } = await db
      .from("entity_types")
      .insert({ organization_id: access.organizationId, name, icon })
      .select("id, name, icon, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ entity_type: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
