import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

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

    // lista miembros + email desde profiles
    const { data: rows, error: listErr } = await db
      .from("organization_members")
      .select("user_id, role, created_at, profiles:profiles(email)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (listErr) throw listErr;

    const members = (rows ?? []).map((r: any) => ({
      user_id: r.user_id,
      role: r.role,
      created_at: r.created_at,
      email: r.profiles?.email ?? "",
    }));

    return NextResponse.json({ organization_id: organizationId, members });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
