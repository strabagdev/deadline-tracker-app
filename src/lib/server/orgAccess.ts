import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";
import { MODULE_KEYS, type ModuleKey, USAGE_CAPTURE_SUBMODULE_PREFIX, defaultModulesByRole } from "@/lib/access/moduleKeys";

type DataClient = ReturnType<typeof createDataServerClient>;

export type OrgAccessError = "no active organization" | "forbidden" | "super admin global only";

export type OrgAccessResult =
  | {
      organizationId: string;
      role: string;
      memberTypeId?: string | null;
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

export async function getMemberAccess(db: DataClient, organizationId: string, userId: string) {
  const { data, error } = await db
    .from("organization_members")
    .select("role, member_type_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.role) return null;
  return {
    role: String(data.role),
    memberTypeId: data.member_type_id ? String(data.member_type_id) : null,
  };
}

export async function getOrgAccess(db: DataClient, userId: string): Promise<OrgAccessResult> {
  const isGlobalOnly = await isSuperAdmin(db, userId);
  if (isGlobalOnly) return { error: "super admin global only" };

  const organizationId = await getActiveOrgId(db, userId);
  if (!organizationId) return { error: "no active organization" };

  const member = await getMemberAccess(db, organizationId, userId);
  if (!member?.role) return { error: "forbidden" };

  return { organizationId, role: member.role, memberTypeId: member.memberTypeId };
}

export async function getAdminOrgAccess(db: DataClient, userId: string): Promise<OrgAccessResult> {
  const access = await getOrgAccess(db, userId);
  if ("error" in access) return access;
  if (!isAdminRole(access.role)) return { error: "forbidden" };
  return access;
}

export { MODULE_KEYS, USAGE_CAPTURE_SUBMODULE_PREFIX, defaultModulesByRole };
export type { ModuleKey };

export async function canViewModule(
  db: DataClient,
  organizationId: string,
  role: string,
  memberTypeId: string | null | undefined,
  moduleKey: ModuleKey
) {
  if (!memberTypeId) return defaultModulesByRole(role).includes(moduleKey);

  const { data, error } = await db
    .from("organization_member_type_modules")
    .select("module_key, can_view")
    .eq("organization_id", organizationId)
    .eq("member_type_id", memberTypeId);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return defaultModulesByRole(role).includes(moduleKey);
  return rows.some((r) => String(r.module_key) === moduleKey && Boolean(r.can_view));
}

export async function canViewUsageCaptureEntityType(
  db: DataClient,
  organizationId: string,
  role: string,
  memberTypeId: string | null | undefined,
  entityTypeId: string
) {
  if (!memberTypeId) return defaultModulesByRole(role).includes("usage_capture");

  const { data, error } = await db
    .from("organization_member_type_modules")
    .select("module_key, can_view")
    .eq("organization_id", organizationId)
    .eq("member_type_id", memberTypeId);
  if (error) throw error;

  const rows = data ?? [];
  if (rows.length === 0) return defaultModulesByRole(role).includes("usage_capture");

  const hasBase = rows.some((r) => String(r.module_key) === "usage_capture" && Boolean(r.can_view));
  if (!hasBase) return false;

  const scoped = rows.filter((r) => String(r.module_key).startsWith(USAGE_CAPTURE_SUBMODULE_PREFIX));
  if (scoped.length === 0) return true;

  const wanted = `${USAGE_CAPTURE_SUBMODULE_PREFIX}${entityTypeId}`;
  return rows.some((r) => String(r.module_key) === wanted && Boolean(r.can_view));
}
