import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const redirectTo = String(body.redirectTo ?? "").trim();

    if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
    if (!redirectTo) return NextResponse.json({ error: "redirectTo required" }, { status: 400 });

    const exists = await authUserExistsByEmail(email);
    if (!exists) {
      return NextResponse.json(
        { error: "Ese email no existe en Auth. Debe iniciar sesión al menos una vez o ser creado previamente." },
        { status: 400 }
      );
    }

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
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
