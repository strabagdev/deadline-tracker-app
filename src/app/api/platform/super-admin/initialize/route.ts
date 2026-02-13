import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { hasAnySuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function POST(req: Request) {
  try {
    const db = createDataServerClient();
    const alreadyExists = await hasAnySuperAdmin(db);
    if (alreadyExists) {
      return NextResponse.json({ error: "super admin already configured" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const setupKey = String(body.setupKey || "").trim();

    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    if (password.length < 8) {
      return NextResponse.json({ error: "password min length is 8" }, { status: 400 });
    }

    const expectedSetupKey = process.env.PLATFORM_SETUP_KEY;
    if (!expectedSetupKey) {
      return NextResponse.json(
        { error: "Missing PLATFORM_SETUP_KEY in server environment" },
        { status: 500 }
      );
    }

    if (setupKey !== expectedSetupKey) {
      return NextResponse.json({ error: "invalid setup key" }, { status: 403 });
    }

    const authAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL!,
      process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY!
    );

    const { data: created, error: createErr } = await authAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 400 });
    }

    const userId = created.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "failed to create super admin user" }, { status: 400 });
    }

    const { error: profileErr } = await db.from("profiles").upsert(
      {
        user_id: userId,
        email,
      },
      { onConflict: "user_id" }
    );
    if (profileErr) throw profileErr;

    const { error: adminErr } = await db.from("platform_admins").insert({ user_id: userId });
    if (adminErr) throw adminErr;

    return NextResponse.json({ ok: true, email, user_id: userId });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
