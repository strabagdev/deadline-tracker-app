import { createClient } from "@supabase/supabase-js";
import { getSupabaseDataServerConfig } from "@/lib/supabase/env";

export function createDataServerClient() {
  const { url, serviceRoleKey } = getSupabaseDataServerConfig();

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase data server configuration");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}
