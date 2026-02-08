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

export async function GET(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const db = createDataServerClient();

    // org activa del requester
    const { data: settings, error: setErr } = await db
      .from("user_settings")
      .select("active_organization_id")
      .eq("user_id", requester.id)
      .maybeSingle();

    if (setErr) throw setErr;

    const organizationId = settings?.active_organization_id;
    if (!organizationId) {
      return NextResponse.json({ error: "no active organization" }, { status: 400 });
    }

    // permiso admin/owner
    const { data: member, error: memErr } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", requester.id)
      .maybeSingle();

    if (memErr) throw memErr;

    if (!member || !["owner", "admin"].includes(member.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // lista miembros (DATA)
    const { data: rows, error: listErr } = await db
      .from("organization_members")
      .select("user_id, role, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (listErr) throw listErr;

    const members = rows ?? [];

    // enriquecer con email desde AUTH central
    const authAdmin = getAuthAdminClient();

    // En MVP: buscamos emails por listUsers (paginado) y armamos map
    // (Suficiente para pocos usuarios. Luego optimizamos con tabla profiles)
    const wantedIds = new Set(members.map((m) => m.user_id));
    const idToEmail = new Map<string, string>();

    const perPage = 200;
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;

      const users = data?.users ?? [];
      for (const u of users) {
        if (wantedIds.has(u.id)) idToEmail.set(u.id, u.email ?? "");
      }
      if (users.length < perPage) break;
    }

    const enriched = members.map((m) => ({
      ...m,
      email: idToEmail.get(m.user_id) ?? "",
    }));

    return NextResponse.json({
      organization_id: organizationId,
      members: enriched,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
