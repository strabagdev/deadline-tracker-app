import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const body = await req.json().catch(() => ({}));
    const organizationId = body.organizationId as string | undefined;

    if (!organizationId) {
      return NextResponse.json(
        { error: "organizationId required" },
        { status: 400 }
      );
    }

    const db = createDataServerClient();

    // Verifica membership
    const { data: member, error: memErr } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr) throw memErr;
    if (!member) {
      return NextResponse.json({ error: "not a member" }, { status: 403 });
    }

    // Guarda org activa
    const { error: setErr } = await db.from("user_settings").upsert({
      user_id: user.id,
      active_organization_id: organizationId,
      updated_at: new Date().toISOString(),
    });

    if (setErr) throw setErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unauthorized" },
      { status: 401 }
    );
  }
}
