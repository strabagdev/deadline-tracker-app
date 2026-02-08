import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

export async function POST(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const body = await req.json().catch(() => ({}));
    const userId = (body.userId as string | undefined)?.trim();

    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    const db = createDataServerClient();

    // org activa del requester
    const { data: settings, error: setErr } = await db
      .from("user_settings")
      .select("active_organization_id")
      .eq("user_id", requester.id)
      .maybeSingle();

    if (setErr) throw setErr;

    const organizationId = settings?.active_organization_id;
    if (!organizationId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    // rol del requester
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

    // no permitir auto-remoción (opcional, recomendado)
    if (userId === requester.id) {
      return NextResponse.json({ error: "No puedes quitarte tu propio acceso." }, { status: 400 });
    }

    // rol del target
    const { data: target, error: tErr } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!target) return NextResponse.json({ error: "Usuario no es miembro de esta org." }, { status: 404 });

    // no permitir remover owner
    if (target.role === "owner") {
      return NextResponse.json({ error: "No se puede remover al owner." }, { status: 400 });
    }

    const { error: delErr } = await db
      .from("organization_members")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId);

    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
