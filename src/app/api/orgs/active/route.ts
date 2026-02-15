import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    // 1) leer org activa
    const { data: settings, error: setErr } = await db
      .from("user_settings")
      .select("active_organization_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (setErr) throw setErr;

    const activeId = settings?.active_organization_id;
    if (!activeId) {
      return NextResponse.json({ organization: null });
    }

    // 2) traer nombre org
    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("id,name,logo_url")
      .eq("id", activeId)
      .maybeSingle();

    if (orgErr) throw orgErr;

    return NextResponse.json({ organization: org ?? null });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json(
      { error: message },
      { status: 401 }
    );
  }
}
