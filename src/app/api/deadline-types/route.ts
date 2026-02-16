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

    const url = new URL(req.url);
    const onlyActive = url.searchParams.get("active") === "1";

    let q = db
      .from("deadline_types")
      .select("id, name, measure_by, requires_document, is_active, created_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: false });

    if (onlyActive) q = q.eq("is_active", true);

    const { data, error } = await q;
    if (error) throw error;

    return NextResponse.json({ deadline_types: data ?? [] });
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
    const measureBy = String(body?.measure_by ?? "").trim(); // date|usage
    const requiresDocument = Boolean(body?.requires_document ?? false);

    if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });
    if (measureBy !== "date" && measureBy !== "usage") {
      return NextResponse.json({ error: "measure_by must be 'date' or 'usage'", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data, error } = await db
      .from("deadline_types")
      .insert({
        organization_id: access.organizationId,
        name,
        measure_by: measureBy,
        requires_document: requiresDocument,
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

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (body?.name != null) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "name cannot be empty", code: "BAD_REQUEST" }, { status: 400 });
      patch.name = name;
    }

    if (body?.measure_by != null) {
      const measureBy = String(body.measure_by).trim();
      if (measureBy !== "date" && measureBy !== "usage") {
        return NextResponse.json({ error: "measure_by must be 'date' or 'usage'", code: "BAD_REQUEST" }, { status: 400 });
      }
      patch.measure_by = measureBy;
    }

    if (body?.requires_document != null) patch.requires_document = Boolean(body.requires_document);
    if (body?.is_active != null) patch.is_active = Boolean(body.is_active);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no fields to update", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { error } = await db
      .from("deadline_types")
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
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    // soft delete (deactivate)
    const { error } = await db
      .from("deadline_types")
      .update({ is_active: false })
      .eq("organization_id", access.organizationId)
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
