import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAssignOwnerPayload,
  parseOrganizationIdPayload,
  parseOrganizationNamePayload,
  parsePlatformInvitePayload,
  parseRemoveOwnerPayload,
} from "../src/lib/api/platformAdminInput";

test("parseOrganizationNamePayload valida largo minimo", () => {
  const bad = parseOrganizationNamePayload({ organizationName: "a" });
  assert.equal(bad.ok, false);

  const ok = parseOrganizationNamePayload({ organizationName: "Org Uno" });
  assert.equal(ok.ok, true);
});

test("parseOrganizationIdPayload exige organizationId", () => {
  const bad = parseOrganizationIdPayload({});
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.body.code, "BAD_REQUEST");

  const ok = parseOrganizationIdPayload({ organizationId: "org-1" });
  assert.equal(ok.ok, true);
});

test("parsePlatformInvitePayload valida organizationId/email/role", () => {
  const roles = ["owner", "admin", "member", "viewer"] as const;
  const badRole = parsePlatformInvitePayload(
    { organizationId: "o1", email: "a@a.com", role: "x" },
    roles
  );
  assert.equal(badRole.ok, false);

  const ok = parsePlatformInvitePayload(
    { organizationId: "o1", email: "A@A.com", role: "member" },
    roles
  );
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.email, "a@a.com");
});

test("parseAssignOwnerPayload exige org y ownerEmail", () => {
  const bad = parseAssignOwnerPayload({ organizationId: "o1" });
  assert.equal(bad.ok, false);

  const ok = parseAssignOwnerPayload({ organizationId: "o1", ownerEmail: "owner@acme.com" });
  assert.equal(ok.ok, true);
});

test("parseRemoveOwnerPayload exige org y ownerUserId", () => {
  const bad = parseRemoveOwnerPayload({ organizationId: "o1" });
  assert.equal(bad.ok, false);

  const ok = parseRemoveOwnerPayload({ organizationId: "o1", ownerUserId: "u1" });
  assert.equal(ok.ok, true);
});
