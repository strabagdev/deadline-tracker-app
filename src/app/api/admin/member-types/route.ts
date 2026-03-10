import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import {
  MODULE_KEYS,
  MEMBER_TYPE_ROLE_PREFIX,
  USAGE_CAPTURE_SUBMODULE_PREFIX,
  decodeMemberTypeBaseRole,
  encodeMemberTypeBaseRole,
  inferMemberTypeBaseRole,
  isBaseRole,
} from "@/lib/access/moduleKeys";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function normalizeModules(
  modulesRaw: unknown[],
  allowedStatic: readonly string[],
  allowedUsageCaptureScoped: string[]
) {
  const allowed = new Set<string>([...allowedStatic, ...allowedUsageCaptureScoped]);
  return modulesRaw
    .map((m: unknown) => String(m))
    .filter((m: string) => allowed.has(m));
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
    const canUsers = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "users");
    if (!canUsers || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const { data: types, error: typesErr } = await db
      .from("organization_member_types")
      .select("id, name, is_active, is_system, created_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: true });
    if (typesErr) throw typesErr;
    const { data: entityTypes, error: etErr } = await db
      .from("entity_types")
      .select("id, name")
      .eq("organization_id", access.organizationId)
      .order("name", { ascending: true });
    if (etErr) throw etErr;

    const typeIds = (types ?? []).map((t) => String(t.id));
    let modulesByType: Record<string, Array<{ module_key: string; can_view: boolean }>> = {};
    const baseRoleByType: Record<string, "owner" | "admin" | "member" | "viewer" | null> = {};
    if (typeIds.length > 0) {
      const { data: modules, error: modErr } = await db
        .from("organization_member_type_modules")
        .select("member_type_id, module_key, can_view")
        .eq("organization_id", access.organizationId)
        .in("member_type_id", typeIds);
      if (modErr) throw modErr;
      modulesByType = {};
      for (const row of modules ?? []) {
        const k = String(row.member_type_id);
        const moduleKey = String(row.module_key);
        const baseRole = decodeMemberTypeBaseRole(moduleKey);
        if (baseRole) {
          baseRoleByType[k] = baseRole;
          continue;
        }
        if (!modulesByType[k]) modulesByType[k] = [];
        modulesByType[k].push({
          module_key: moduleKey,
          can_view: Boolean(row.can_view),
        });
      }
    }

    return NextResponse.json({
      organization_id: access.organizationId,
      module_keys: MODULE_KEYS,
      usage_capture_submodule_keys: (entityTypes ?? []).map((et) => ({
        module_key: `${USAGE_CAPTURE_SUBMODULE_PREFIX}${String(et.id)}`,
        entity_type_id: String(et.id),
        entity_type_name: String(et.name ?? ""),
      })),
      member_types: (types ?? []).map((t) => ({
        ...t,
        base_role: baseRoleByType[String(t.id)] ?? inferMemberTypeBaseRole(String(t.name ?? "")) ?? "member",
        modules: modulesByType[String(t.id)] ?? [],
      })),
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
    const canUsers = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "users");
    if (!canUsers || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    if (access.role !== "owner") {
      return NextResponse.json({ error: "owner only", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const baseRoleRaw = String(body?.base_role ?? "member").trim().toLowerCase();
    if (!name) return NextResponse.json({ error: "name required", code: "BAD_REQUEST" }, { status: 400 });
    if (!isBaseRole(baseRoleRaw)) {
      return NextResponse.json({ error: "invalid base_role", code: "BAD_REQUEST" }, { status: 400 });
    }
    const { data: entityTypes, error: etErr } = await db
      .from("entity_types")
      .select("id")
      .eq("organization_id", access.organizationId);
    if (etErr) throw etErr;
    const usageCaptureScoped = (entityTypes ?? []).map((et) => `${USAGE_CAPTURE_SUBMODULE_PREFIX}${String(et.id)}`);
    const modulesRaw = Array.isArray(body?.modules) ? body.modules : [];
    const modules = normalizeModules(modulesRaw, MODULE_KEYS, usageCaptureScoped);

    const { data: inserted, error: insErr } = await db
      .from("organization_member_types")
      .insert({
        organization_id: access.organizationId,
        name,
        is_active: true,
        is_system: false,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;
    const memberTypeId = String(inserted?.id ?? "");

    if (memberTypeId && modules.length > 0) {
      const { error: modErr } = await db.from("organization_member_type_modules").insert(
        [encodeMemberTypeBaseRole(baseRoleRaw), ...modules].map((m: string) => ({
          organization_id: access.organizationId,
          member_type_id: memberTypeId,
          module_key: m,
          can_view: true,
        }))
      );
      if (modErr) throw modErr;
    } else if (memberTypeId) {
      const { error: roleErr } = await db.from("organization_member_type_modules").insert({
        organization_id: access.organizationId,
        member_type_id: memberTypeId,
        module_key: encodeMemberTypeBaseRole(baseRoleRaw),
        can_view: true,
      });
      if (roleErr) throw roleErr;
    }

    return NextResponse.json({ id: memberTypeId }, { status: 201 });
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
    const canUsers = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "users");
    if (!canUsers || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    if (access.role !== "owner") {
      return NextResponse.json({ error: "owner only", code: "FORBIDDEN" }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const name = body?.name != null ? String(body.name).trim() : null;
    const isActive = body?.is_active != null ? Boolean(body.is_active) : null;
    const baseRoleRaw = body?.base_role != null ? String(body.base_role).trim().toLowerCase() : null;
    const modulesRaw = Array.isArray(body?.modules) ? body.modules : null;
    const { data: entityTypes, error: etErr } = await db
      .from("entity_types")
      .select("id")
      .eq("organization_id", access.organizationId);
    if (etErr) throw etErr;
    const usageCaptureScoped = (entityTypes ?? []).map((et) => `${USAGE_CAPTURE_SUBMODULE_PREFIX}${String(et.id)}`);

    const patch: Record<string, unknown> = {};
    if (name != null) {
      if (!name) return NextResponse.json({ error: "name cannot be empty", code: "BAD_REQUEST" }, { status: 400 });
      patch.name = name;
    }
    if (isActive != null) patch.is_active = isActive;
    if (baseRoleRaw != null && !isBaseRole(baseRoleRaw)) {
      return NextResponse.json({ error: "invalid base_role", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data: typeRow, error: typeErr } = await db
      .from("organization_member_types")
      .select("id, is_system, name")
      .eq("organization_id", access.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (typeErr) throw typeErr;
    if (!typeRow) return NextResponse.json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });
    if (Boolean(typeRow.is_system) && name != null && String(typeRow.name).toLowerCase() !== name.toLowerCase()) {
      return NextResponse.json({ error: "system type name cannot be changed", code: "BAD_REQUEST" }, { status: 400 });
    }

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await db
        .from("organization_member_types")
        .update(patch)
        .eq("organization_id", access.organizationId)
        .eq("id", id);
      if (upErr) throw upErr;
    }

    if (modulesRaw) {
      const modules = normalizeModules(modulesRaw, MODULE_KEYS, usageCaptureScoped);

      const { error: delErr } = await db
        .from("organization_member_type_modules")
        .delete()
        .eq("organization_id", access.organizationId)
        .eq("member_type_id", id);
      if (delErr) throw delErr;

      const effectiveBaseRole = (baseRoleRaw ?? inferMemberTypeBaseRole(String(typeRow.name ?? "")) ?? "member") as "owner" | "admin" | "member" | "viewer";
      const nextModuleRows = [encodeMemberTypeBaseRole(effectiveBaseRole), ...modules].map((m: string) => ({
        organization_id: access.organizationId,
        member_type_id: id,
        module_key: m,
        can_view: true,
      }));
      const { error: insModErr } = await db.from("organization_member_type_modules").insert(nextModuleRows);
      if (insModErr) throw insModErr;
    } else if (baseRoleRaw != null) {
      const { error: delRoleErr } = await db
        .from("organization_member_type_modules")
        .delete()
        .eq("organization_id", access.organizationId)
        .eq("member_type_id", id)
        .like("module_key", `${MEMBER_TYPE_ROLE_PREFIX}%`);
      if (delRoleErr) throw delRoleErr;
      const { error: insRoleErr } = await db.from("organization_member_type_modules").insert({
        organization_id: access.organizationId,
        member_type_id: id,
        module_key: encodeMemberTypeBaseRole(baseRoleRaw),
        can_view: true,
      });
      if (insRoleErr) throw insRoleErr;
    }

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
    const canUsers = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "users");
    if (!canUsers || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    if (access.role !== "owner") {
      return NextResponse.json({ error: "owner only", code: "FORBIDDEN" }, { status: 403 });
    }

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const { data: typeRow, error: typeErr } = await db
      .from("organization_member_types")
      .select("id, is_system, name")
      .eq("organization_id", access.organizationId)
      .eq("id", id)
      .maybeSingle();
    if (typeErr) throw typeErr;
    if (!typeRow) return NextResponse.json({ error: "not found", code: "NOT_FOUND" }, { status: 404 });

    if (Boolean(typeRow.is_system)) {
      return NextResponse.json({ error: "system type cannot be deleted", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { error: depErr } = await db
      .from("organization_members")
      .update({ member_type_id: null, role: "member" })
      .eq("organization_id", access.organizationId)
      .eq("member_type_id", id);
    if (depErr) throw depErr;

    const { error: delErr } = await db
      .from("organization_member_types")
      .delete()
      .eq("organization_id", access.organizationId)
      .eq("id", id);
    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
