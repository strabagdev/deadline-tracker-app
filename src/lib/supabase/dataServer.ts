import { createClient } from "@supabase/supabase-js";

export function createDataServerClient() {
  const url = process.env.SUPABASE_DATA_URL;
  const key = process.env.SUPABASE_DATA_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_DATA_URL or SUPABASE_DATA_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
