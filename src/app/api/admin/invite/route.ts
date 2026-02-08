import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { createClient } from "@supabase/supabase-js";

function getAuthAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL;
  const service = process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY;

  if (!url || !service) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_AUTH_URL or SUPABASE_AUTH_SERVICE_ROLE_KEY");
  }

  return createClient(url, service, { auth: { persistSession: false } });
}

async function findUserIdByEmail(authAdmin: any, email: string): Promise<string | null> {
  // Para dev/MVP: listamos y buscamos. (Suficiente)
  // En prod se puede optimizar con procesos/tabla espejo.
  const perPage = 200;
  let page = 1;

  while (page <= 10) {
    const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users ?? [];
    const match = users.find((u: any) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (match?.id) return match.id;

    if (users.length < perPage) break;
    page++;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const { user: inviter } = await requireAuthUser(req);
    const body = await req.json().catch(() => ({}));

    const email = (body.email as string | undefined)?.trim();
    const role = (body.role as string | undefined) ?? "member";

    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    if (!["owner", "admin", "member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }

    const db = createDataServerClient();

    // 1) Org activa del inviter
    const { data: settings, error: setErr } = await db
      .from("user_settings")
      .select("active_organization_id")
      .eq("user_id", inviter.id)
      .maybeSingle();

    if (setErr) throw setErr;

    const organizationId = settings?.active_organization_id;
    if (!organizationId) {
      return NextResponse.json({ error: "no active organization" }, { status: 400 });
    }

    // 2) Verificar permisos del inviter (owner/admin)
    const { data: inviterMember, error: memErr } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", inviter.id)
      .maybeSingle();

    if (memErr) throw memErr;

    if (!inviterMember || !["owner", "admin"].includes(inviterMember.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 3) Invitar / asegurar usuario en Auth central
    const authAdmin = getAuthAdminClient();

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`;

    // inviteUserByEmail envía correo si el usuario no existe (o según estado).
    // Para obtener el user_id de forma robusta, buscamos por email luego.
    const { error: inviteErr } = await authAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    });

    // Si falla por rate limit u otra cosa, cortamos.
    // Si el usuario ya existía, igual podemos continuar obteniendo el user_id.
    if (inviteErr && !String(inviteErr.message || "").toLowerCase().includes("already registered")) {
      return NextResponse.json({ error: inviteErr.message }, { status: 400 });
    }

    const invitedUserId = await findUserIdByEmail(authAdmin, email);
    if (!invitedUserId) {
      return NextResponse.json(
        { error: "No se pudo resolver el user_id del invitado (intenta de nuevo en 10s)." },
        { status: 500 }
      );
    }

    // 4) Regla: 1 usuario = 1 org en esta plataforma
    const { data: existing, error: exErr } = await db
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", invitedUserId);

    if (exErr) throw exErr;

    if ((existing ?? []).length > 0) {
      const existingOrgId = existing![0].organization_id;
      if (existingOrgId !== organizationId) {
        return NextResponse.json(
          { error: "El usuario ya pertenece a otra organización en esta plataforma." },
          { status: 409 }
        );
      }
      // Si ya está en la misma org, solo actualizamos rol
      const { error: updErr } = await db
        .from("organization_members")
        .update({ role })
        .eq("organization_id", organizationId)
        .eq("user_id", invitedUserId);

      if (updErr) throw updErr;

      return NextResponse.json({ ok: true, userId: invitedUserId, updated: true });
    }

    // 5) Crear membership en la org activa del inviter
    const { error: insErr } = await db.from("organization_members").insert({
      organization_id: organizationId,
      user_id: invitedUserId,
      role,
    });

    if (insErr) throw insErr;

    return NextResponse.json({ ok: true, userId: invitedUserId, invited: !inviteErr });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
