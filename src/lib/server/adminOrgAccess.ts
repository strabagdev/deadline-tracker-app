import { createDataServerClient } from "@/lib/supabase/dataServer";

export type AdminRole = "owner" | "admin";

export type AdminOrgAccessResult =
  | { organizationId: string; role: AdminRole }
  | { error: "no active organization" | "forbidden" };

type DataServerClient = ReturnType<typeof createDataServerClient>;

export async function getAdminOrgAccess(
  db: DataServerClient,
  userId: string
): Promise<AdminOrgAccessResult> {
  const { data: settings, error: settingsError } = await db
    .from("user_settings")
    .select("active_organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (settingsError) throw settingsError;

  const organizationId = settings?.active_organization_id;
  if (!organizationId) {
    return { error: "no active organization" };
  }

  const { data: member, error: memberError } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) throw memberError;

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return { error: "forbidden" };
  }

  return { organizationId, role: member.role };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}
