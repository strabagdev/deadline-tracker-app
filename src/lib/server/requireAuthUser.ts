import { createClient } from "@supabase/supabase-js";

function getErrorText(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; code?: unknown; name?: unknown };
    return [maybe.name, maybe.code, maybe.message]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0)
      .join(" ");
  }
  return String(error ?? "");
}

function isTransientAuthError(error: unknown) {
  const text = getErrorText(error).toLowerCase();
  return (
    text.includes("fetch failed") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("socket hang up") ||
    text.includes("network")
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requireAuthUser(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) throw new Error("Missing Bearer token");

  const url = process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY!;

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error) throw error;
      if (!data.user) throw new Error("Invalid session");
      return { user: data.user, token };
    } catch (error: unknown) {
      lastError = error;
      if (!isTransientAuthError(error) || attempt === 2) break;
      await sleep(200 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Invalid session");
}
