import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";

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

const ALLOWED_FIELD_TYPES = new Set(["text", "number", "date", "boolean", "select"]);

async function listUsageFieldKeys(
  db: ReturnType<typeof createDataServerClient>,
  organizationId: string,
  usageUnitId: string,
  excludeId?: string
) {
  const { data, error } = await db
    .from("usage_fields")
    .select("id, key")
    .eq("organization_id", organizationId)
    .eq("usage_unit_id", usageUnitId);
  if (error) throw error;
  return new Set(
    ((data ?? []) as Array<{ id: string; key: string | null }>)
      .filter((row) => !excludeId || String(row.id) !== excludeId)
      .map((row) => String(row.key ?? "").trim())
      .filter(Boolean)
  );
}

function nextAvailableKey(baseKey: string, existingKeys: Set<string>) {
  if (!existingKeys.has(baseKey)) return baseKey;
  let seq = 2;
  for (;;) {
    const candidate = `${baseKey}_${seq}`;
    if (!existingKeys.has(candidate)) return candidate;
    seq += 1;
  }
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

    const usageUnitId = new URL(req.url).searchParams.get("usage_unit_id");
    if (!usageUnitId) return NextResponse.json({ error: "usage_unit_id required", code: "BAD_REQUEST" }, { status: 400 });

    const { data, error } = await db
      .from("usage_fields")
      .select("id, usage_unit_id, name, key, field_type, options, created_at")
      .eq("organization_id", access.organizationId)
      .eq("usage_unit_id", usageUnitId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ usage_fields: data ?? [] });
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
    const usageUnitId = String(body?.usage_unit_id ?? "").trim();
    const name = String(body?.name ?? "").trim();
    const fieldType = String(body?.field_type ?? "text").trim();
    const rawKey = body?.key ? String(body.key) : name;
    const baseKey = toSlugKey(rawKey);

    if (!usageUnitId) return NextResponse.json({ error: "usage_unit_id required", code: "BAD_REQUEST" }, { status: 400 });
    if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });
    if (!baseKey) return NextResponse.json({ error: "key required", code: "BAD_REQUEST" }, { status: 400 });
    if (!ALLOWED_FIELD_TYPES.has(fieldType)) {
      return NextResponse.json({ error: "invalid field_type", code: "BAD_REQUEST" }, { status: 400 });
    }

    const existingKeys = await listUsageFieldKeys(db, access.organizationId, usageUnitId);
    const key = body?.key
      ? baseKey
      : nextAvailableKey(baseKey, existingKeys);

    const options = body?.options ?? null;
    const { data, error } = await db
      .from("usage_fields")
      .insert({
        organization_id: access.organizationId,
        usage_unit_id: usageUnitId,
        name,
        key,
        field_type: fieldType,
        options,
      })
      .select("id, usage_unit_id, name, key, field_type, options, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ usage_field: data }, { status: 201 });
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

    const { data: existing, error: existingErr } = await db
      .from("usage_fields")
      .select("id")
      .eq("organization_id", access.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return NextResponse.json({ error: "field not found", code: "USAGE_FIELD_NOT_FOUND" }, { status: 404 });

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
      if (!ALLOWED_FIELD_TYPES.has(fieldType)) {
        return NextResponse.json({ error: "invalid field_type", code: "BAD_REQUEST" }, { status: 400 });
      }
      patch.field_type = fieldType;
    }
    if (body?.options !== undefined) patch.options = body.options;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "no changes provided", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data, error } = await db
      .from("usage_fields")
      .update(patch)
      .eq("organization_id", access.organizationId)
      .eq("id", id)
      .select("id, usage_unit_id, name, key, field_type, options, created_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ usage_field: data });
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

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const { error } = await db
      .from("usage_fields")
      .delete()
      .eq("organization_id", access.organizationId)
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
