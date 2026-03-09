import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function parseSuggestedValues(input: unknown) {
  if (!Array.isArray(input)) return [] as string[];
  return input
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 0)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
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
    const canUsageUnits = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "usage_units"
    );
    if (!canUsageUnits) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const onlyActive = new URL(req.url).searchParams.get("active") === "1";
    let qWithSuggested = db
      .from("usage_units")
      .select("id, name, is_active, show_in_usage_records, suggested_values, created_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: false });
    if (onlyActive) qWithSuggested = qWithSuggested.eq("is_active", true);

    const withSuggested = await qWithSuggested;
    if (!withSuggested.error) {
      return NextResponse.json({ usage_units: withSuggested.data ?? [] });
    }

    const errText = String((withSuggested.error as { message?: string })?.message ?? "").toLowerCase();
    if (!errText.includes("suggested_values")) throw withSuggested.error;

    let qLegacy = db
      .from("usage_units")
      .select("id, name, is_active, show_in_usage_records, created_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: false });
    if (onlyActive) qLegacy = qLegacy.eq("is_active", true);

    const legacy = await qLegacy;
    if (legacy.error) throw legacy.error;
    return NextResponse.json({
      usage_units: (legacy.data ?? []).map((u) => ({ ...u, suggested_values: [] })),
    });
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
    const canUsageUnits = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "usage_units"
    );
    if (!canUsageUnits || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const showInUsageRecords = body?.show_in_usage_records == null ? true : Boolean(body.show_in_usage_records);
    const suggestedValues = parseSuggestedValues(body?.suggested_values);
    if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });

    const { data, error } = await db
      .from("usage_units")
      .insert({
        organization_id: access.organizationId,
        name,
        is_active: true,
        show_in_usage_records: showInUsageRecords,
        suggested_values: suggestedValues,
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
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canUsageUnits = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "usage_units"
    );
    if (!canUsageUnits || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
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
    if (body?.show_in_usage_records != null) patch.show_in_usage_records = Boolean(body.show_in_usage_records);
    if (body?.suggested_values != null) patch.suggested_values = parseSuggestedValues(body.suggested_values);

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no fields to update", code: "BAD_REQUEST" }, { status: 400 });
    }

    let { error } = await db
      .from("usage_units")
      .update(patch)
      .eq("organization_id", access.organizationId)
      .eq("id", id);
    const errText = String((error as { message?: string } | null)?.message ?? "").toLowerCase();
    if (error && errText.includes("suggested_values")) {
      const patchWithoutSuggested = { ...patch };
      delete patchWithoutSuggested.suggested_values;
      const fallback = await db
        .from("usage_units")
        .update(patchWithoutSuggested)
        .eq("organization_id", access.organizationId)
        .eq("id", id);
      error = fallback.error;
    }
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
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canUsageUnits = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "usage_units"
    );
    if (!canUsageUnits || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
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
