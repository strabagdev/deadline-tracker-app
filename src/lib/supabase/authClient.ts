import { createClient } from "@supabase/supabase-js";

export const supabaseAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY!
);
