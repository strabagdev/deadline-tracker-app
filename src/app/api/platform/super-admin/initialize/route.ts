import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { hasAnySuperAdmin } from "@/lib/server/superAdmin";
import {
  parseSuperAdminInitializePayload,
  validateSuperAdminSetupKey,
} from "@/lib/api/platformSuperAdminInput";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function POST(req: Request) {
  try {
    const db = createDataServerClient();
    const alreadyExists = await hasAnySuperAdmin(db);
    if (alreadyExists) {
      return NextResponse.json({ error: "super admin already configured", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = parseSuperAdminInitializePayload(body);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    const { email, password, setupKey } = parsed;

    const expectedSetupKey = process.env.PLATFORM_SETUP_KEY;
    const setupValidation = validateSuperAdminSetupKey({ setupKey, expectedSetupKey });
    if (!setupValidation.ok) return NextResponse.json(setupValidation.body, { status: setupValidation.status });

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
      return NextResponse.json({ error: createErr.message, code: "BAD_REQUEST" }, { status: 400 });
    }

    const userId = created.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "failed to create super admin user", code: "BAD_REQUEST" }, { status: 400 });
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
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
