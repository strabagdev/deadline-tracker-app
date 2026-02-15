import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) {
      return NextResponse.json({ error: "super admin only" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const organizationName = String(body.organizationName || "").trim();

    if (organizationName.length < 2) {
      return NextResponse.json({ error: "organizationName required (min 2 chars)" }, { status: 400 });
    }

    const { data: org, error: orgErr } = await db
      .from("organizations")
      .insert({ name: organizationName })
      .select("id,name")
      .single();

    if (orgErr) throw orgErr;

    return NextResponse.json({
      ok: true,
      organization: org,
      owner: null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
