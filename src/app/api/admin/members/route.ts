import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

export async function GET(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const db = createDataServerClient();

    // 1) org activa
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

    // 2) permiso admin/owner
    const { data: reqMember, error: reqErr } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", requester.id)
      .maybeSingle();

    if (reqErr) throw reqErr;

    if (!reqMember || !["owner", "admin"].includes(reqMember.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    // 3) lista memberships
    const { data: members, error: memErr } = await db
      .from("organization_members")
      .select("user_id, role, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (memErr) throw memErr;

    const list = members ?? [];
    const userIds = list.map((m) => m.user_id);

    // 4) trae profiles en un segundo query (sin join)
    let profilesMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await db
        .from("profiles")
        .select("user_id, email")
        .in("user_id", userIds);

      if (profErr) throw profErr;

      (profiles ?? []).forEach((p: any) => profilesMap.set(p.user_id, p.email ?? ""));
    }

    const enriched = list.map((m) => ({
      ...m,
      email: profilesMap.get(m.user_id) ?? "",
    }));

    return NextResponse.json({ organization_id: organizationId, members: enriched });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
