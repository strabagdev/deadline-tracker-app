import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getErrorMessage } from "@/lib/server/adminOrgAccess";

export async function POST(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const body = await req.json().catch(() => ({}));
    const userId = (body.userId as string | undefined)?.trim();

    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    const db = createDataServerClient();

    const ctx = await getAdminOrgAccess(db, requester.id);
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: 403 });
    }

    const { organizationId } = ctx;

    if (userId === requester.id) {
      return NextResponse.json({ error: "No puedes quitarte tu propio acceso." }, { status: 400 });
    }

    const { data: target, error: tErr } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!target) return NextResponse.json({ error: "Usuario no es miembro de esta org." }, { status: 404 });

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
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
