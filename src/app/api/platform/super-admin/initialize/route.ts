import { NextResponse } from "next/server";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { createAuthAdminClient, findAuthUserIdByEmail } from "@/lib/server/authAdmin";
import { getConfiguredSuperAdminEmail, hasAnySuperAdmin } from "@/lib/server/superAdmin";
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
    const body = await req.json().catch(() => ({}));
    const parsed = parseSuperAdminInitializePayload(body);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    const { authMode, email, password, setupKey } = parsed;

    const configuredEmail = getConfiguredSuperAdminEmail();
    if (configuredEmail && email !== configuredEmail) {
      return NextResponse.json(
        { error: `El super admin inicial debe ser ${configuredEmail}.`, code: "FORBIDDEN" },
        { status: 403 }
      );
    }

    const existingConfiguredAuthUserId = configuredEmail ? await findAuthUserIdByEmail(configuredEmail) : null;
    const alreadyExists = await hasAnySuperAdmin(db);
    if (alreadyExists && (!configuredEmail || existingConfiguredAuthUserId)) {
      return NextResponse.json({ error: "super admin already configured", code: "FORBIDDEN" }, { status: 403 });
    }

    const expectedSetupKey = process.env.PLATFORM_SETUP_KEY;
    const setupValidation = validateSuperAdminSetupKey({ setupKey, expectedSetupKey });
    if (!setupValidation.ok) return NextResponse.json(setupValidation.body, { status: setupValidation.status });

    const authAdmin = createAuthAdminClient();

    let userId = await findAuthUserIdByEmail(email);

    if (authMode === "associate-existing") {
      if (!userId) {
        return NextResponse.json(
          {
            error: "Ese email no existe todavía en el Auth central. Usa la opción de crear usuario nuevo.",
            code: "BAD_REQUEST",
          },
          { status: 400 }
        );
      }
    }

    if (authMode === "create-new") {
      if (userId) {
        return NextResponse.json(
          {
            error: "Ese email ya existe en el Auth central. Usa la opción de asociar usuario existente.",
            code: "BAD_REQUEST",
          },
          { status: 400 }
        );
      }

      const { data: created, error: createErr } = await authAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

      if (createErr) {
        return NextResponse.json({ error: createErr.message, code: "BAD_REQUEST" }, { status: 400 });
      }

      userId = created.user?.id ?? null;
      if (!userId) {
        return NextResponse.json({ error: "failed to create super admin user", code: "BAD_REQUEST" }, { status: 400 });
      }
    }

    const { error: profileErr } = await db.from("profiles").upsert(
      {
        user_id: userId,
        email,
      },
      { onConflict: "user_id" }
    );
    if (profileErr) throw profileErr;

    const { error: adminErr } = await db.from("platform_admins").upsert({ user_id: userId }, { onConflict: "user_id" });
    if (adminErr) throw adminErr;

    return NextResponse.json({ ok: true, email, user_id: userId, auth_mode: authMode });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
