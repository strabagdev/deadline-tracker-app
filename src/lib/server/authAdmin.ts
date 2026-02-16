import { createClient } from "@supabase/supabase-js";

export function createAuthAdminClient() {
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL;
  const authServiceRole = process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY;

  if (!authUrl || !authServiceRole) {
    throw new Error("Missing auth env vars");
  }

  return createClient(authUrl, authServiceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const authAdmin = createAuthAdminClient();
  const target = email.trim().toLowerCase();

  let page = 1;
  const perPage = 200;

  while (page <= 50) {
    const { data, error } = await authAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const users = data?.users ?? [];

    const found = users.find((u) => (u.email || "").trim().toLowerCase() === target);
    if (found?.id) return found.id;

    if (users.length < perPage) break;
    page += 1;
  }

  return null;
}
