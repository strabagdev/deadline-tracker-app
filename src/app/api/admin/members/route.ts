import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";

type MemberRow = {
  user_id: string;
  role: string;
  member_type_id?: string | null;
  created_at: string;
  organization_member_types?: { name: string | null } | { name: string | null }[] | null;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "error";
}

export async function GET(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, requester.id);
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
    const organizationId = access.organizationId;

    const { data: members, error: memErr } = await db
      .from("organization_members")
      .select("user_id, role, member_type_id, created_at, organization_member_types(name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (memErr) throw memErr;

    const list = (members as MemberRow[] | null | undefined) ?? [];
    const userIds = list.map((m) => m.user_id);

    const profilesMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await db
        .from("profiles")
        .select("user_id, email")
        .in("user_id", userIds);

      if (profErr) throw profErr;

      ((profiles as ProfileRow[] | null | undefined) ?? []).forEach((p) => {
        profilesMap.set(p.user_id, p.email ?? "");
      });
    }

    const enriched = list.map((m) => ({
      ...m,
      email: profilesMap.get(m.user_id) ?? "",
      member_type_name: Array.isArray(m.organization_member_types)
        ? m.organization_member_types[0]?.name ?? null
        : m.organization_member_types?.name ?? null,
    }));

    return NextResponse.json({ organization_id: organizationId, members: enriched });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, requester.id);
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

    const body = await req.json().catch(() => ({}));
    const userId = String(body.user_id ?? "").trim();
    const role = String(body.role ?? "").trim().toLowerCase();
    const memberTypeIdRaw = String(body.member_type_id ?? "").trim();
    const memberTypeId = memberTypeIdRaw || null;

    if (!userId) {
      return NextResponse.json({ error: "user_id required", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (!["owner", "admin", "member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "invalid role", code: "BAD_REQUEST" }, { status: 400 });
    }

    const organizationId = access.organizationId;

    const { data: existingMember, error: existingErr } = await db
      .from("organization_members")
      .select("user_id, role, member_type_id")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existingMember) {
      return NextResponse.json({ error: "member not found", code: "NOT_FOUND" }, { status: 404 });
    }

    if (String(existingMember.user_id) === requester.id && role !== String(existingMember.role)) {
      return NextResponse.json({ error: "no puedes cambiar tu propio rol desde aqui", code: "BAD_REQUEST" }, { status: 400 });
    }

    if (access.role !== "owner") {
      if (role === "owner") {
        return NextResponse.json({ error: "solo owner puede asignar owner", code: "FORBIDDEN" }, { status: 403 });
      }
      if (String(existingMember.role) === "owner") {
        return NextResponse.json({ error: "solo owner puede editar otro owner", code: "FORBIDDEN" }, { status: 403 });
      }
    }

    if (memberTypeId) {
      const { data: mt, error: mtErr } = await db
        .from("organization_member_types")
        .select("id, is_active")
        .eq("organization_id", organizationId)
        .eq("id", memberTypeId)
        .maybeSingle();
      if (mtErr) throw mtErr;
      if (!mt || !mt.is_active) {
        return NextResponse.json({ error: "invalid member_type_id", code: "BAD_REQUEST" }, { status: 400 });
      }
    }

    const { error: updateErr } = await db
      .from("organization_members")
      .update({
        role,
        member_type_id: memberTypeId,
      })
      .eq("organization_id", organizationId)
      .eq("user_id", userId);
    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(error), code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
