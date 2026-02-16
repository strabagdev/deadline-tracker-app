import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataClient = ReturnType<typeof createDataServerClient>;

export type OrgAccessError = "no active organization" | "forbidden";

export type OrgAccessResult =
  | {
      organizationId: string;
      role: string;
    }
  | {
      error: OrgAccessError;
    };

export function isAdminRole(role: string | null) {
  return role === "owner" || role === "admin";
}

export async function getActiveOrgId(db: DataClient, userId: string) {
  const { data, error } = await db
    .from("user_settings")
    .select("active_organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.active_organization_id as string) || null;
}

export async function getMemberRole(db: DataClient, organizationId: string, userId: string) {
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.role as string) || null;
}

export async function getOrgAccess(db: DataClient, userId: string): Promise<OrgAccessResult> {
  const organizationId = await getActiveOrgId(db, userId);
  if (!organizationId) return { error: "no active organization" };

  const role = await getMemberRole(db, organizationId, userId);
  if (!role) return { error: "forbidden" };

  return { organizationId, role };
}

export async function getAdminOrgAccess(db: DataClient, userId: string): Promise<OrgAccessResult> {
  const access = await getOrgAccess(db, userId);
  if ("error" in access) return access;
  if (!isAdminRole(access.role)) return { error: "forbidden" };
  return access;
}
