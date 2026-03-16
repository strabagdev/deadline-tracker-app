import { createClient } from "@supabase/supabase-js";

type SupabaseAuthClient = ReturnType<typeof createClient>;

let cachedClient: SupabaseAuthClient | null = null;

function getSupabaseAuthClient(): SupabaseAuthClient {
  if (cachedClient) return cachedClient;

  const url = String(process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL ?? "").trim();
  const anonKey = String(process.env.NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY ?? "").trim();

  if (!url || !anonKey) {
    throw new Error("Missing Supabase auth public configuration");
  }

  cachedClient = createClient(url, anonKey);
  return cachedClient;
}

export const supabaseAuth = new Proxy({} as SupabaseAuthClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabaseAuthClient(), prop, receiver);
  },
});
