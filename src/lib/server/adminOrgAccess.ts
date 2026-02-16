import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess as getAdminOrgAccessFromOrg, isAdminRole } from "@/lib/server/orgAccess";

export type AdminRole = "owner" | "admin";

export type AdminOrgAccessResult =
  | { organizationId: string; role: AdminRole }
  | { error: "no active organization" | "forbidden" };

type DataServerClient = ReturnType<typeof createDataServerClient>;

export async function getAdminOrgAccess(
  db: DataServerClient,
  userId: string
): Promise<AdminOrgAccessResult> {
  const access = await getAdminOrgAccessFromOrg(db, userId);
  if ("error" in access) return access;
  if (!isAdminRole(access.role)) return { error: "forbidden" };
  return { organizationId: access.organizationId, role: access.role as AdminRole };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}
