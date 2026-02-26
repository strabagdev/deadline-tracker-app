import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getOrgAccess } from "@/lib/server/orgAccess";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
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
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }

    const url = new URL(req.url);
    const entityTypeId = url.searchParams.get("entity_type_id");
    if (!entityTypeId) return NextResponse.json({ error: "entity_type_id required", code: "BAD_REQUEST" }, { status: 400 });

    const { data, error } = await db
      .from("entity_fields")
      .select("id, entity_type_id, name, key, field_type, show_in_card, analytics_mode, options, created_at")
      .eq("organization_id", access.organizationId)
      .eq("entity_type_id", entityTypeId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ entity_fields: data ?? [] });
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
    const entityTypeId = String(body?.entity_type_id ?? "").trim();
    const name = String(body?.name ?? "").trim();
    const fieldType = String(body?.field_type ?? "text").trim();
    const showInCard = Boolean(body?.show_in_card ?? false);
    const analyticsMode = String(body?.analytics_mode ?? "none").trim();

    const rawKey = body?.key ? String(body.key) : name;
    const key = toSlugKey(rawKey);

    if (!entityTypeId) return NextResponse.json({ error: "entity_type_id required", code: "BAD_REQUEST" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });
    if (!key) return NextResponse.json({ error: "key required", code: "BAD_REQUEST" }, { status: 400 });

    const allowed = new Set(["text", "number", "date", "boolean", "select"]);
    if (!allowed.has(fieldType)) {
      return NextResponse.json({ error: "invalid field_type", code: "BAD_REQUEST" }, { status: 400 });
    }
    const allowedAnalytics = new Set(["none", "distribution", "trend", "count"]);
    if (!allowedAnalytics.has(analyticsMode)) {
      return NextResponse.json({ error: "invalid analytics_mode", code: "BAD_REQUEST" }, { status: 400 });
    }

    const options = body?.options ?? null;

    const { data, error } = await db
      .from("entity_fields")
      .insert({
        organization_id: access.organizationId,
        entity_type_id: entityTypeId,
        name,
        key,
        field_type: fieldType,
        show_in_card: showInCard,
        analytics_mode: analyticsMode,
        options,
      })
      .select("id, entity_type_id, name, key, field_type, show_in_card, analytics_mode, options, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ entity_field: data }, { status: 201 });
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

    const { data: existing, error: existingErr } = await db
      .from("entity_fields")
      .select("id, organization_id, name, key, field_type, show_in_card, analytics_mode, options")
      .eq("organization_id", access.organizationId)
      .eq("id", id)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (!existing) return NextResponse.json({ error: "field not found", code: "ENTITY_FIELD_NOT_FOUND" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (body?.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });
      patch.name = name;
    }

    if (body?.key !== undefined) {
      const key = toSlugKey(String(body.key));
      if (!key) return NextResponse.json({ error: "key required", code: "BAD_REQUEST" }, { status: 400 });
      patch.key = key;
    }

    if (body?.field_type !== undefined) {
      const fieldType = String(body.field_type).trim();
      const allowed = new Set(["text", "number", "date", "boolean", "select"]);
      if (!allowed.has(fieldType)) {
        return NextResponse.json({ error: "invalid field_type", code: "BAD_REQUEST" }, { status: 400 });
      }
      patch.field_type = fieldType;
    }

    if (body?.show_in_card !== undefined) {
      patch.show_in_card = Boolean(body.show_in_card);
    }
    if (body?.analytics_mode !== undefined) {
      const analyticsMode = String(body.analytics_mode).trim();
      const allowedAnalytics = new Set(["none", "distribution", "trend", "count"]);
      if (!allowedAnalytics.has(analyticsMode)) {
        return NextResponse.json({ error: "invalid analytics_mode", code: "BAD_REQUEST" }, { status: 400 });
      }
      patch.analytics_mode = analyticsMode;
    }

    if (body?.options !== undefined) {
      patch.options = body.options;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no changes provided", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data, error } = await db
      .from("entity_fields")
      .update(patch)
      .eq("organization_id", access.organizationId)
      .eq("id", id)
      .select("id, entity_type_id, name, key, field_type, show_in_card, analytics_mode, options, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ entity_field: data });
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
    const id = String(url.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const { data: existing, error: existingErr } = await db
      .from("entity_fields")
      .select("id")
      .eq("organization_id", access.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing?.id) {
      return NextResponse.json({ error: "field not found", code: "ENTITY_FIELD_NOT_FOUND" }, { status: 404 });
    }

    const { error } = await db
      .from("entity_fields")
      .delete()
      .eq("organization_id", access.organizationId)
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
