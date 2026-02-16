import { parseAssignOwnerPayload, parseRemoveOwnerPayload } from "./platformAdminInput";

type OrgRow = { id: string; name: string };
type ProfileRow = { user_id: string; email: string | null };
type OwnerMemberRow = { organization_id: string; user_id: string; role: string };

export type PlatformAdminOrgsRepo = {
  getOrganizationById: (organizationId: string) => Promise<OrgRow | null>;
  getProfileByEmail: (ownerEmail: string) => Promise<ProfileRow | null>;
  resolveAuthUserIdByEmail: (ownerEmail: string) => Promise<string | null>;
  upsertProfile?: (userId: string, email: string) => Promise<void>;
  upsertOwnerMembership: (organizationId: string, userId: string) => Promise<void>;
  getOwnerMember: (organizationId: string, userId: string) => Promise<OwnerMemberRow | null>;
  listOwners: (organizationId: string) => Promise<Array<{ user_id: string }>>;
  deleteOwnerMembership: (organizationId: string, userId: string) => Promise<void>;
};

type ServiceResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function handlePlatformAssignOwner(rawBody: unknown, repo: PlatformAdminOrgsRepo): Promise<ServiceResponse> {
  const parsed = parseAssignOwnerPayload(rawBody);
  if (!parsed.ok) return { status: parsed.status, body: parsed.body };
  const { organizationId, ownerEmail } = parsed;

  const org = await repo.getOrganizationById(organizationId);
  if (!org?.id) return { status: 404, body: { error: "organization not found", code: "ORGANIZATION_NOT_FOUND" } };

  const authUserId = await repo.resolveAuthUserIdByEmail(ownerEmail);
  if (!authUserId) {
    return {
      status: 400,
      body: { error: "Owner email does not exist in Auth. Invite/login first.", code: "OWNER_NOT_FOUND_IN_AUTH" },
    };
  }

  // El profile puede no existir todavía. Si falla su creación por esquema/políticas,
  // no bloqueamos la asignación del owner porque membership usa user_id.
  if (repo.upsertProfile) {
    try {
      await repo.upsertProfile(authUserId, ownerEmail);
    } catch {
      // noop
    }
  }

  await repo.upsertOwnerMembership(organizationId, authUserId);

  return {
    status: 200,
    body: {
      ok: true,
      organization: { id: org.id, name: org.name },
      owner: { user_id: authUserId, email: ownerEmail },
    },
  };
}

export async function handlePlatformRemoveOwner(rawBody: unknown, repo: PlatformAdminOrgsRepo): Promise<ServiceResponse> {
  const parsed = parseRemoveOwnerPayload(rawBody);
  if (!parsed.ok) return { status: parsed.status, body: parsed.body };
  const { organizationId, ownerUserId } = parsed;

  const target = await repo.getOwnerMember(organizationId, ownerUserId);
  if (!target?.user_id) return { status: 404, body: { error: "owner not found in organization", code: "OWNER_NOT_FOUND" } };
  if (target.role !== "owner") return { status: 400, body: { error: "target user is not owner", code: "BAD_REQUEST" } };

  const owners = await repo.listOwners(organizationId);
  if ((owners ?? []).length <= 1) {
    return {
      status: 400,
      body: { error: "Cannot remove the last owner. Assign another owner first.", code: "LAST_OWNER" },
    };
  }

  await repo.deleteOwnerMembership(organizationId, ownerUserId);
  return { status: 200, body: { ok: true } };
}
