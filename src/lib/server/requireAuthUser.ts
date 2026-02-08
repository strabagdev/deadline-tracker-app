import { createClient } from "@supabase/supabase-js";

export async function requireAuthUser(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) throw new Error("Missing Bearer token");

  const url = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY!;

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid session");

  return { user: data.user, token };
}
