import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getErrorMessage } from "@/lib/server/adminOrgAccess";
import { createClient } from "@supabase/supabase-js";

type MemberListRow = {
  user_id: string;
  role: string;
  created_at: string;
  profiles: { email: string | null } | null;
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
      return NextResponse.json({ error: ctx.error }, { status: 403 });
    }

    const { organizationId } = ctx;

    const { data: rows, error: listErr } = await db
      .from("organization_members")
      .select("user_id, role, created_at, profiles:profiles(email)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (listErr) throw listErr;

    const members = (rows as MemberListRow[] | null | undefined)?.map((r) => ({
      user_id: r.user_id,
      role: r.role,
      created_at: r.created_at,
      email: r.profiles?.email ?? "",
    })) ?? [];

    return NextResponse.json({ organization_id: organizationId, members });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
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
      return NextResponse.json({ error: ctx.error }, { status: 403 });
    }

    const { organizationId } = ctx;

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "member");

    if (!email) {
      return NextResponse.json({ error: "email required" }, { status: 400 });
    }

    if (!["member", "admin", "viewer"].includes(role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    const supabaseAuthAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL!,
      process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY!
    );

    const redirectTo = new URL("/auth/callback", req.url).toString();
    const { data: inviteData, error: inviteErr } =
      await supabaseAuthAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { needs_temp_password: true },
      });

    let invitedUserId = inviteData.user?.id ?? null;
    if (inviteErr) {
      // Si ya existe en Auth, reusamos profile para asignar membership en la org.
      if (inviteErr.message.toLowerCase().includes("already")) {
        const { data: existingProfile, error: existingErr } = await db
          .from("profiles")
          .select("user_id")
          .eq("email", email)
          .maybeSingle();

        if (existingErr) throw existingErr;
        invitedUserId = existingProfile?.user_id ?? null;
      } else {
        return NextResponse.json({ error: inviteErr.message }, { status: 400 });
      }
    }

    if (!invitedUserId) {
      return NextResponse.json(
        { error: "No se pudo resolver el usuario invitado. Pídele iniciar sesión una vez e intenta de nuevo." },
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
        role,
      },
      { onConflict: "organization_id,user_id" }
    );

    if (memberErr) throw memberErr;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
