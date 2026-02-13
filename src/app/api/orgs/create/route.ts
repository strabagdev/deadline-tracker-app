import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

export async function POST(req: Request) {
  try {
    const allowBootstrap = process.env.ALLOW_ORG_BOOTSTRAP === "true";
    if (!allowBootstrap) {
      return NextResponse.json(
        { error: "organization bootstrap disabled" },
        { status: 403 }
      );
    }

    const { user } = await requireAuthUser(req);
    const body = await req.json().catch(() => ({}));
    const name = body.name as string | undefined;

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return NextResponse.json(
        { error: "name required (min 2 chars)" },
        { status: 400 }
      );
    }

    const db = createDataServerClient();

    // 1) Crea org
    const { data: org, error: orgErr } = await db
      .from("organizations")
      .insert({ name: name.trim() })
      .select("id,name")
      .single();

    if (orgErr) throw orgErr;

    // 2) Creador queda owner
    const { error: memErr } = await db.from("organization_members").insert({
      organization_id: org.id,
      user_id: user.id,
      role: "owner",
    });

    if (memErr) throw memErr;

    // 3) Set org activa
    const { error: setErr } = await db.from("user_settings").upsert({
      user_id: user.id,
      active_organization_id: org.id,
      updated_at: new Date().toISOString(),
    });

    if (setErr) throw setErr;

    return NextResponse.json({ organization: org });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json(
      { error: message },
      { status: 401 }
    );
  }
}
