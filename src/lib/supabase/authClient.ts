import { createClient } from "@supabase/supabase-js";
import { getSupabaseAuthPublicConfig } from "@/lib/supabase/env";

type SupabaseAuthClient = ReturnType<typeof createClient>;

let cachedClient: SupabaseAuthClient | null = null;
let storageSanitized = false;

function storageKeyForSupabaseUrl(url: string) {
  try {
    const hostname = new URL(url).hostname;
    const projectRef = hostname.split(".")[0];
    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

function sessionLooksRefreshable(rawValue: string | null) {
  if (!rawValue) return true;

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object") return false;

    const maybeSession = parsed as { access_token?: unknown; refresh_token?: unknown; currentSession?: unknown };
    const session =
      maybeSession.currentSession && typeof maybeSession.currentSession === "object"
        ? (maybeSession.currentSession as { access_token?: unknown; refresh_token?: unknown })
        : maybeSession;

    return typeof session.access_token === "string" && typeof session.refresh_token === "string";
  } catch {
    return false;
  }
}

function sanitizeInvalidAuthStorage(url: string) {
  if (storageSanitized || typeof window === "undefined") return;
  storageSanitized = true;

  const key = storageKeyForSupabaseUrl(url);
  if (!key) return;

  try {
    if (!sessionLooksRefreshable(window.localStorage.getItem(key))) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function getSupabaseAuthClient(): SupabaseAuthClient {
  if (cachedClient) return cachedClient;

  const { url, anonKey } = getSupabaseAuthPublicConfig();

  if (!url || !anonKey) {
    throw new Error("Missing Supabase auth public configuration");
  }

  sanitizeInvalidAuthStorage(url);
  cachedClient = createClient(url, anonKey);
  return cachedClient;
}

export const supabaseAuth = new Proxy({} as SupabaseAuthClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabaseAuthClient(), prop, receiver);
  },
});
