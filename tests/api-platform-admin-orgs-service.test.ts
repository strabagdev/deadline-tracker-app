import test from "node:test";
import assert from "node:assert/strict";
import {
  handlePlatformAssignOwner,
  handlePlatformRemoveOwner,
  type PlatformAdminOrgsRepo,
} from "../src/lib/api/platformAdminOrgsService";

function repo(overrides?: Partial<PlatformAdminOrgsRepo>): PlatformAdminOrgsRepo {
  return {
    getOrganizationById: async () => ({ id: "o1", name: "Org Uno" }),
    getProfileByEmail: async () => ({ user_id: "u1", email: "owner@acme.com" }),
    resolveAuthUserIdByEmail: async () => "u1",
    upsertProfile: async () => undefined,
    upsertOwnerMembership: async () => undefined,
    getOwnerMember: async () => ({ organization_id: "o1", user_id: "u1", role: "owner" }),
    listOwners: async () => [{ user_id: "u1" }, { user_id: "u2" }],
    deleteOwnerMembership: async () => undefined,
    ...overrides,
  };
}

test("assign owner valida payload", async () => {
  const res = await handlePlatformAssignOwner({}, repo());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("assign owner responde 404 si org no existe", async () => {
  const res = await handlePlatformAssignOwner(
    { organizationId: "o1", ownerEmail: "owner@acme.com" },
    repo({ getOrganizationById: async () => null })
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "ORGANIZATION_NOT_FOUND");
});

test("assign owner responde 400 si owner no existe en Auth", async () => {
  const res = await handlePlatformAssignOwner(
    { organizationId: "o1", ownerEmail: "owner@acme.com" },
    repo({ getProfileByEmail: async () => null, resolveAuthUserIdByEmail: async () => null })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "OWNER_NOT_FOUND_IN_AUTH");
});

test("assign owner responde ok", async () => {
  const res = await handlePlatformAssignOwner(
    { organizationId: "o1", ownerEmail: "owner@acme.com" },
    repo()
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test("remove owner valida payload", async () => {
  const res = await handlePlatformRemoveOwner({}, repo());
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "BAD_REQUEST");
});

test("remove owner responde 404 si owner no existe", async () => {
  const res = await handlePlatformRemoveOwner(
    { organizationId: "o1", ownerUserId: "u1" },
    repo({ getOwnerMember: async () => null })
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.code, "OWNER_NOT_FOUND");
});

test("remove owner no permite remover último owner", async () => {
  const res = await handlePlatformRemoveOwner(
    { organizationId: "o1", ownerUserId: "u1" },
    repo({ listOwners: async () => [{ user_id: "u1" }] })
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.code, "LAST_OWNER");
});

test("remove owner responde ok", async () => {
  const res = await handlePlatformRemoveOwner(
    { organizationId: "o1", ownerUserId: "u1" },
    repo()
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});
