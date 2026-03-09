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
