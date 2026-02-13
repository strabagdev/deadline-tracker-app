import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

type OwnerProfileRow = {
  user_id: string;
  email: string;
};

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
    const ownerEmail = String(body.ownerEmail || "").trim().toLowerCase();

    if (organizationName.length < 2) {
      return NextResponse.json({ error: "organizationName required (min 2 chars)" }, { status: 400 });
    }

    if (!ownerEmail) {
      return NextResponse.json({ error: "ownerEmail required" }, { status: 400 });
    }

    const { data: ownerProfile, error: ownerErr } = await db
      .from("profiles")
      .select("user_id, email")
      .eq("email", ownerEmail)
      .maybeSingle();

    if (ownerErr) throw ownerErr;

    const owner = ownerProfile as OwnerProfileRow | null;
    if (!owner?.user_id) {
      return NextResponse.json(
        { error: "Owner email does not exist in profiles yet. Ask that user to login once first." },
        { status: 400 }
      );
    }

    const { data: org, error: orgErr } = await db
      .from("organizations")
      .insert({ name: organizationName })
      .select("id,name")
      .single();

    if (orgErr) throw orgErr;

    const { error: memberErr } = await db.from("organization_members").upsert(
      {
        organization_id: org.id,
        user_id: owner.user_id,
        role: "owner",
      },
      { onConflict: "organization_id,user_id" }
    );

    if (memberErr) throw memberErr;

    const { error: settingsErr } = await db.from("user_settings").upsert({
      user_id: owner.user_id,
      active_organization_id: org.id,
      updated_at: new Date().toISOString(),
    });

    if (settingsErr) throw settingsErr;

    return NextResponse.json({
      ok: true,
      organization: org,
      owner: { user_id: owner.user_id, email: owner.email },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
