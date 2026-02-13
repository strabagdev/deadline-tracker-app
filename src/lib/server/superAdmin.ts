import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataServerClient = ReturnType<typeof createDataServerClient>;

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  return maybe.code === "42P01" || (maybe.message || "").toLowerCase().includes("does not exist");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

type PlatformAdminRow = {
  user_id: string;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
};

async function getPrimarySuperAdmin(db: DataServerClient) {
  const { data, error } = await db
    .from("platform_admins")
    .select("user_id, created_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  const primary = data as PlatformAdminRow | null;
  if (!primary?.user_id) {
    return { userId: null, email: null };
  }

  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("user_id, email")
    .eq("user_id", primary.user_id)
    .maybeSingle();

  if (profileError) throw profileError;

  const p = profile as ProfileRow | null;
  return {
    userId: primary.user_id,
    email: p?.email ?? null,
  };
}

export async function hasAnySuperAdmin(db: DataServerClient): Promise<boolean> {
  const { data, error } = await db.from("platform_admins").select("user_id").limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export async function isSuperAdmin(db: DataServerClient, userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.user_id);
}

export async function getSuperAdminStatus(db: DataServerClient, userId: string) {
  try {
    const hasSuperAdmin = await hasAnySuperAdmin(db);
    const isCurrentSuperAdmin = hasSuperAdmin ? await isSuperAdmin(db, userId) : false;
    const primary = await getPrimarySuperAdmin(db);

    return {
      hasSuperAdmin,
      isCurrentSuperAdmin,
      primarySuperAdminUserId: primary.userId,
      primarySuperAdminEmail: primary.email,
    };
  } catch (error: unknown) {
    if (isMissingTableError(error)) {
      throw new Error(
        "Missing table platform_admins. Run SQL bootstrap migration before enabling super admin flow."
      );
    }
    throw new Error(getErrorMessage(error));
  }
}

export async function bootstrapFirstSuperAdmin(
  db: DataServerClient,
  userId: string,
  userEmail: string
) {
  const hasSuperAdmin = await hasAnySuperAdmin(db);
  if (hasSuperAdmin) {
    const alreadySuperAdmin = await isSuperAdmin(db, userId);
    if (alreadySuperAdmin) return { created: false, alreadySuperAdmin: true };
    return { created: false, alreadySuperAdmin: false };
  }

  const normalizedEmail = userEmail.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Authenticated user has no email");
  }

  const { error: profileErr } = await db.from("profiles").upsert(
    {
      user_id: userId,
      email: normalizedEmail,
    },
    { onConflict: "user_id" }
  );
  if (profileErr) throw profileErr;

  const { error } = await db.from("platform_admins").insert({ user_id: userId });
  if (error) throw error;
  return { created: true, alreadySuperAdmin: true };
}
