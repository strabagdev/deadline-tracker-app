import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getPublicAppUrl } from "@/lib/server/publicAppOrigin";
import { createAuthAdminClient } from "@/lib/server/authAdmin";
import { isResendConfigured, sendAuthEmail } from "@/lib/server/authEmail";

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

async function authUserExistsByEmail(email: string) {
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL;
  const serviceRoleKey = process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY;
  if (!authUrl || !serviceRoleKey) {
    throw new Error("Missing auth server configuration");
  }

  const adminClient = createClient(authUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const target = email.trim().toLowerCase();
  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    const users = data?.users ?? [];
    const found = users.find((u) => (u.email || "").trim().toLowerCase() === target);
    if (found) return true;

    if (users.length < perPage) break;
    page += 1;
  }

  return false;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const redirectTo = getPublicAppUrl(req, "/reset-password");

    if (!email) return NextResponse.json({ error: "email required", code: "BAD_REQUEST" }, { status: 400 });

    const exists = await authUserExistsByEmail(email);
    if (!exists) {
      return NextResponse.json(
        {
          error: "Ese email no existe en Auth. Debe iniciar sesión al menos una vez o ser creado previamente.",
          code: "AUTH_USER_NOT_FOUND",
        },
        { status: 400 }
      );
    }

    if (isResendConfigured()) {
      const authAdmin = createAuthAdminClient();
      const { data, error } = await authAdmin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      if (error) {
        return NextResponse.json({ error: error.message, code: "BAD_REQUEST" }, { status: 400 });
      }

      const actionLink = data.properties?.action_link ?? "";
      if (!actionLink) {
        return NextResponse.json({ error: "No se pudo generar el enlace de recuperación", code: "BAD_REQUEST" }, { status: 400 });
      }

      await sendAuthEmail({
        kind: "recovery",
        to: email,
        actionUrl: actionLink,
      });
    } else {
      const authUrl = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY;
      if (!authUrl || !anonKey) {
        throw new Error("Missing auth public configuration");
      }

      const publicClient = createClient(authUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { error } = await publicClient.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) {
        return NextResponse.json({ error: error.message, code: "BAD_REQUEST" }, { status: 400 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
