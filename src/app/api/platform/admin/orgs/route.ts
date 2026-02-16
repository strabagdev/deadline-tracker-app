import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";
import { findAuthUserIdByEmail } from "@/lib/server/authAdmin";
import {
  handlePlatformAssignOwner,
  handlePlatformRemoveOwner,
  type PlatformAdminOrgsRepo,
} from "@/lib/api/platformAdminOrgsService";

type OrgRow = {
  id: string;
  name: string;
  created_at: string;
};

type OrgMemberRow = {
  organization_id: string;
  user_id: string;
  role: string;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "error";
}

function makePlatformAdminOrgsRepo(db: ReturnType<typeof createDataServerClient>): PlatformAdminOrgsRepo {
  return {
    getOrganizationById: async (organizationId) => {
      const { data, error } = await db
        .from("organizations")
        .select("id,name")
        .eq("id", organizationId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { id: string; name: string } | null;
    },
    resolveAuthUserIdByEmail: (ownerEmail) => findAuthUserIdByEmail(ownerEmail),
    upsertProfile: async (userId, email) => {
      const { error } = await db.from("profiles").upsert(
        { user_id: userId, email },
        { onConflict: "user_id" }
      );
      if (error) throw error;
    },
    upsertOwnerMembership: async (organizationId, userId) => {
      const { error } = await db.from("organization_members").upsert(
        {
          organization_id: organizationId,
          user_id: userId,
          role: "owner",
        },
        { onConflict: "organization_id,user_id" }
      );
      if (error) throw error;
    },
    getOwnerMember: async (organizationId, userId) => {
      const { data, error } = await db
        .from("organization_members")
        .select("organization_id,user_id,role")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as { organization_id: string; user_id: string; role: string } | null;
    },
    listOwners: async (organizationId) => {
      const { data, error } = await db
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", organizationId)
        .eq("role", "owner");
      if (error) throw error;
      return (data ?? []) as Array<{ user_id: string }>;
    },
    deleteOwnerMembership: async (organizationId, userId) => {
      const { error } = await db
        .from("organization_members")
        .delete()
        .eq("organization_id", organizationId)
        .eq("user_id", userId);
      if (error) throw error;
    },
  };
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });

    const { data: orgsData, error: orgErr } = await db
      .from("organizations")
      .select("id,name,created_at")
      .order("created_at", { ascending: true });
    if (orgErr) throw orgErr;

    const orgs = (orgsData ?? []) as OrgRow[];
    const orgIds = orgs.map((o) => o.id);

    let members: OrgMemberRow[] = [];
    if (orgIds.length > 0) {
      const { data: membersData, error: memErr } = await db
        .from("organization_members")
        .select("organization_id,user_id,role")
        .in("organization_id", orgIds);
      if (memErr) throw memErr;
      members = (membersData ?? []) as OrgMemberRow[];
    }
    const userIds = Array.from(new Set(members.map((m) => m.user_id)));

    const profilesByUserId = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profilesData, error: profErr } = await db
        .from("profiles")
        .select("user_id,email")
        .in("user_id", userIds);
      if (profErr) throw profErr;

      ((profilesData ?? []) as ProfileRow[]).forEach((p) => {
        profilesByUserId.set(p.user_id, p.email ?? "");
      });
    }

    const byOrg = new Map<string, OrgMemberRow[]>();
    members.forEach((m) => {
      const list = byOrg.get(m.organization_id) ?? [];
      list.push(m);
      byOrg.set(m.organization_id, list);
    });

    const result = orgs.map((o) => {
      const orgMembers = byOrg.get(o.id) ?? [];
      const owners = orgMembers
        .filter((m) => m.role === "owner")
        .map((m) => ({
          user_id: m.user_id,
          email: profilesByUserId.get(m.user_id) ?? null,
        }));

      return {
        id: o.id,
        name: o.name,
        created_at: o.created_at,
        member_count: orgMembers.length,
        owners,
      };
    });

    return NextResponse.json({ organizations: result });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const response = await handlePlatformAssignOwner(body, makePlatformAdminOrgsRepo(db));
    return NextResponse.json(response.body, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const response = await handlePlatformRemoveOwner(body, makePlatformAdminOrgsRepo(db));
    return NextResponse.json(response.body, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
