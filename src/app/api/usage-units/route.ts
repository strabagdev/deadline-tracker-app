import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getOrgAccess } from "@/lib/server/orgAccess";

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

    const onlyActive = new URL(req.url).searchParams.get("active") === "1";
    let q = db
      .from("usage_units")
      .select("id, name, is_active, created_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: false });

    if (onlyActive) q = q.eq("is_active", true);

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ usage_units: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      const status = access.error === "no active organization" ? 400 : 403;
      const error = access.error === "forbidden" ? "admin required" : access.error;
      const code = access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN";
      return NextResponse.json({ error, code }, { status });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });

    const { data, error } = await db
      .from("usage_units")
      .insert({
        organization_id: access.organizationId,
        name,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ id: data?.id }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      const status = access.error === "no active organization" ? 400 : 403;
      const error = access.error === "forbidden" ? "admin required" : access.error;
      const code = access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN";
      return NextResponse.json({ error, code }, { status });
    }

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (body?.name != null) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "name cannot be empty", code: "BAD_REQUEST" }, { status: 400 });
      patch.name = name;
    }
    if (body?.is_active != null) patch.is_active = Boolean(body.is_active);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no fields to update", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { error } = await db
      .from("usage_units")
      .update(patch)
      .eq("organization_id", access.organizationId)
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      const status = access.error === "no active organization" ? 400 : 403;
      const error = access.error === "forbidden" ? "admin required" : access.error;
      const code = access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN";
      return NextResponse.json({ error, code }, { status });
    }

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const hardDelete = url.searchParams.get("hard") === "1";
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const op = hardDelete
      ? db.from("usage_units").delete().eq("organization_id", access.organizationId).eq("id", id)
      : db.from("usage_units").update({ is_active: false }).eq("organization_id", access.organizationId).eq("id", id);
    const { error } = await op;
    if (error) throw error;

    return NextResponse.json({ ok: true, mode: hardDelete ? "hard_delete" : "deactivate" });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
