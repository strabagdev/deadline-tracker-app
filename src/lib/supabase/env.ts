function firstNonEmpty(...values: Array<string | undefined>) {
  const value = values.map((item) => String(item ?? "").trim()).find(Boolean);
  return value ?? "";
}

export function getSupabaseDataServerConfig() {
  const url = firstNonEmpty(
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_DATA_URL,
    process.env.NEXT_PUBLIC_DATA_SUPABASE_URL
  );
  const serviceRoleKey = firstNonEmpty(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_DATA_SERVICE_ROLE_KEY
  );

  return { url, serviceRoleKey };
}

export function getSupabaseAuthPublicConfig() {
  const url = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL,
    process.env.NEXT_PUBLIC_AUTH_SUPABASE_URL,
    process.env.NEXT_PUBLIC_DATA_SUPABASE_URL
  );
  const anonKey = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_AUTH_ANON_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_AUTH_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_AUTH_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_AUTH_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_DATA_SUPABASE_ANON_KEY
  );

  return { url, anonKey };
}

export function getSupabaseAuthServerConfig() {
  const publicConfig = getSupabaseAuthPublicConfig();
  const url = firstNonEmpty(
    publicConfig.url,
    process.env.SUPABASE_URL,
    process.env.SUPABASE_AUTH_URL,
    process.env.SUPABASE_DATA_URL
  );
  const serviceRoleKey = firstNonEmpty(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY,
    process.env.SUPABASE_DATA_SERVICE_ROLE_KEY
  );

  return {
    ...publicConfig,
    url,
    serviceRoleKey,
  };
}
