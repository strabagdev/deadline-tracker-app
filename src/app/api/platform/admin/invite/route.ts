import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

const VALID_ROLES = ["owner", "admin", "member", "viewer"] as const;

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = String(body.organizationId ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "member").trim().toLowerCase();

    if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });
    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    if (!VALID_ROLES.includes(role as (typeof VALID_ROLES)[number])) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("id,name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!org?.id) return NextResponse.json({ error: "organization not found" }, { status: 404 });

    const authUrl = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL;
    const authServiceRole = process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY;
    if (!authUrl || !authServiceRole) {
      throw new Error("Missing auth env vars");
    }

    const authAdmin = createClient(authUrl, authServiceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const redirectTo = new URL("/auth/callback", req.url).toString();
    const { data: inviteData, error: inviteErr } = await authAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { needs_temp_password: true },
    });

    let invitedUserId = inviteData.user?.id ?? null;
    if (inviteErr) {
      if (inviteErr.message.toLowerCase().includes("already")) {
        // Usuario ya existe en auth, buscamos profile o lo creamos si está ausente.
        const { data: existingProfile, error: existingErr } = await db
          .from("profiles")
          .select("user_id")
          .ilike("email", email)
          .maybeSingle();
        if (existingErr) throw existingErr;
        invitedUserId = existingProfile?.user_id ?? null;
      } else {
        return NextResponse.json({ error: inviteErr.message }, { status: 400 });
      }
    }

    if (!invitedUserId) {
      // Fallback: intentar resolver en Auth y sincronizar profile.
      let page = 1;
      const perPage = 200;
      while (page <= 50 && !invitedUserId) {
        const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
        if (error) throw error;
        const users = data?.users ?? [];
        const found = users.find((u) => (u.email || "").trim().toLowerCase() === email);
        if (found?.id) invitedUserId = found.id;
        if (users.length < perPage) break;
        page += 1;
      }
    }

    if (!invitedUserId) {
      return NextResponse.json(
        { error: "No se pudo resolver el usuario invitado. Pídele iniciar sesión una vez e intenta de nuevo." },
        { status: 400 }
      );
    }

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

    return NextResponse.json({
      ok: true,
      organization: { id: org.id, name: org.name },
      invited: { user_id: invitedUserId, email, role },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
