import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getErrorMessage } from "@/lib/server/adminOrgAccess";
import { createClient } from "@supabase/supabase-js";
import { findAuthUserIdByEmail } from "@/lib/server/authAdmin";
import { getPublicAppOrigin } from "@/lib/server/publicAppOrigin";

type MemberListRow = {
  user_id: string;
  role: string;
  member_type_id?: string | null;
  created_at: string;
  profiles?: { email?: string | null } | { email?: string | null }[] | null;
  organization_member_types?: { name?: string | null } | { name?: string | null }[] | null;
};

/*
  Este endpoint:
  - GET  → lista miembros de la org activa
  - POST → invita usuario a la org activa
*/

/* ===========================
   GET - Listar miembros
=========================== */
export async function GET(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const db = createDataServerClient();

    const ctx = await getAdminOrgAccess(db, requester.id);
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error, code: "FORBIDDEN" }, { status: 403 });
    }

    const { organizationId } = ctx;

    const { data: rows, error: listErr } = await db
      .from("organization_members")
      .select("user_id, role, member_type_id, created_at, profiles:profiles(email), organization_member_types(name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (listErr) throw listErr;

    const safeRows: MemberListRow[] = Array.isArray(rows) ? (rows as MemberListRow[]) : [];
    const members = safeRows.map((r) => ({
      user_id: r.user_id,
      role: r.role,
      member_type_id: r.member_type_id ?? null,
      member_type_name: Array.isArray(r.organization_member_types)
        ? r.organization_member_types[0]?.name ?? null
        : r.organization_member_types?.name ?? null,
      created_at: r.created_at,
      email: Array.isArray(r.profiles) ? r.profiles[0]?.email ?? "" : r.profiles?.email ?? "",
    }));

    return NextResponse.json({ organization_id: organizationId, members });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ===========================
   POST - Invitar usuario
=========================== */
export async function POST(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const db = createDataServerClient();

    const ctx = await getAdminOrgAccess(db, requester.id);
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error, code: "FORBIDDEN" }, { status: 403 });
    }

    const { organizationId } = ctx;

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "member");
    const memberTypeId = body.member_type_id ? String(body.member_type_id).trim() : "";

    if (!email) {
      return NextResponse.json({ error: "email required", code: "BAD_REQUEST" }, { status: 400 });
    }

    if (!["member", "admin", "viewer", "owner"].includes(role)) {
      return NextResponse.json({ error: "invalid role", code: "BAD_REQUEST" }, { status: 400 });
    }

    let effectiveRole = role;
    let effectiveMemberTypeId: string | null = memberTypeId || null;
    if (memberTypeId) {
      const { data: mt, error: mtErr } = await db
        .from("organization_member_types")
        .select("id, name, is_active")
        .eq("organization_id", organizationId)
        .eq("id", memberTypeId)
        .maybeSingle();
      if (mtErr) throw mtErr;
      if (!mt || !mt.is_active) {
        return NextResponse.json({ error: "invalid member_type_id", code: "BAD_REQUEST" }, { status: 400 });
      }
      const name = String(mt.name ?? "").trim().toLowerCase();
      if (["owner", "admin", "member", "viewer"].includes(name)) {
        effectiveRole = name;
      } else {
        effectiveRole = "member";
      }
      effectiveMemberTypeId = String(mt.id);
    }

    const supabaseAuthAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL!,
      process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY!
    );

    const redirectTo = `${getPublicAppOrigin(req)}/auth/callback`;
    const { data: inviteData, error: inviteErr } =
      await supabaseAuthAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { needs_temp_password: true },
      });

    let invitedUserId = inviteData.user?.id ?? null;
    if (inviteErr) {
      // Si ya existe en Auth, reusamos profile para asignar membership en la org.
      if (inviteErr.message.toLowerCase().includes("already")) {
        invitedUserId = await findAuthUserIdByEmail(email);
      } else {
        return NextResponse.json({ error: inviteErr.message, code: "BAD_REQUEST" }, { status: 400 });
      }
    }

    if (!invitedUserId) {
      return NextResponse.json(
        { error: "No se pudo resolver el usuario invitado. Pídele iniciar sesión una vez e intenta de nuevo.", code: "INVITED_USER_NOT_RESOLVED" },
        { status: 400 }
      );
    }

    // profiles usa user_id como clave.
    const { error: profileErr } = await db.from("profiles").upsert(
      {
        user_id: invitedUserId,
        email,
      },
      { onConflict: "user_id" }
    );

    if (profileErr) throw profileErr;

    const { error: memberErr } = await db.from("organization_members").upsert(
      {
        organization_id: organizationId,
        user_id: invitedUserId,
        role: effectiveRole,
        member_type_id: effectiveMemberTypeId,
      },
      { onConflict: "organization_id,user_id" }
    );

    if (memberErr) throw memberErr;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
