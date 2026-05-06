import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthServerConfig } from "@/lib/supabase/env";

export function createAuthAdminClient() {
  const { url, serviceRoleKey } = getSupabaseAuthServerConfig();

  if (!url || !serviceRoleKey) {
    throw new Error("Missing auth env vars");
  }

  return createClient(url, serviceRoleKey, {
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
