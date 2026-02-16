import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";
import { parseOrganizationNamePayload } from "@/lib/api/platformAdminInput";

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
      return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = parseOrganizationNamePayload(body);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    const { organizationName } = parsed;

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
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
