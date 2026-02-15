import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";
import { createClient } from "@supabase/supabase-js";

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
  return "error";
}

async function resolveAuthUserIdByEmail(email: string) {
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL;
  const authServiceRole = process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY;
  if (!authUrl || !authServiceRole) return null;

  const authAdmin = createClient(authUrl, authServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let page = 1;
  const perPage = 200;
  const target = email.trim().toLowerCase();

  while (page <= 50) {
    const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];

    const found = users.find((u) => (u.email || "").trim().toLowerCase() === target);
    if (found?.id) return found.id;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only" }, { status: 403 });

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
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = String(body.organizationId ?? "").trim();
    const ownerEmail = String(body.ownerEmail ?? "").trim().toLowerCase();

    if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
    if (!ownerEmail) return NextResponse.json({ error: "ownerEmail required" }, { status: 400 });

    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("id,name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!org?.id) return NextResponse.json({ error: "organization not found" }, { status: 404 });

    const { data: profile, error: profErr } = await db
      .from("profiles")
      .select("user_id,email")
      .ilike("email", ownerEmail)
      .maybeSingle();
    if (profErr) throw profErr;

    let ownerUserId = profile?.user_id ?? null;
    let ownerResolvedEmail = profile?.email ?? ownerEmail;

    // Fallback: si existe en Auth pero aún no en profiles (DB de datos), lo sincronizamos.
    if (!ownerUserId) {
      const authUserId = await resolveAuthUserIdByEmail(ownerEmail);
      if (!authUserId) {
        return NextResponse.json(
          { error: "Owner email does not exist in Auth. Invite/login first." },
          { status: 400 }
        );
      }

      const { error: upProfileErr } = await db.from("profiles").upsert(
        { user_id: authUserId, email: ownerEmail },
        { onConflict: "user_id" }
      );
      if (upProfileErr) throw upProfileErr;

      ownerUserId = authUserId;
      ownerResolvedEmail = ownerEmail;
    }

    const { error: upErr } = await db.from("organization_members").upsert(
      {
        organization_id: organizationId,
        user_id: ownerUserId,
        role: "owner",
      },
      { onConflict: "organization_id,user_id" }
    );
    if (upErr) throw upErr;

    return NextResponse.json({
      ok: true,
      organization: { id: org.id, name: org.name },
      owner: { user_id: ownerUserId, email: ownerResolvedEmail },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = String(body.organizationId ?? "").trim();
    const ownerUserId = String(body.ownerUserId ?? "").trim();

    if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
    if (!ownerUserId) return NextResponse.json({ error: "ownerUserId required" }, { status: 400 });

    const { data: target, error: targetErr } = await db
      .from("organization_members")
      .select("organization_id,user_id,role")
      .eq("organization_id", organizationId)
      .eq("user_id", ownerUserId)
      .maybeSingle();
    if (targetErr) throw targetErr;
    if (!target?.user_id) return NextResponse.json({ error: "owner not found in organization" }, { status: 404 });
    if (target.role !== "owner") return NextResponse.json({ error: "target user is not owner" }, { status: 400 });

    const { data: owners, error: ownersErr } = await db
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("role", "owner");
    if (ownersErr) throw ownersErr;

    if ((owners ?? []).length <= 1) {
      return NextResponse.json(
        { error: "Cannot remove the last owner. Assign another owner first." },
        { status: 400 }
      );
    }

    const { error: delErr } = await db
      .from("organization_members")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", ownerUserId);
    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
