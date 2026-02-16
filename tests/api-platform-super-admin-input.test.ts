import test from "node:test";
import assert from "node:assert/strict";
import {
  parseSuperAdminInitializePayload,
  validateBootstrapConfirmPayload,
  validateSuperAdminSetupKey,
} from "../src/lib/api/platformSuperAdminInput";

test("parseSuperAdminInitializePayload valida email y password", () => {
  const badEmail = parseSuperAdminInitializePayload({ password: "12345678", setupKey: "x" });
  assert.equal(badEmail.ok, false);

  const badPassword = parseSuperAdminInitializePayload({ email: "a@a.com", password: "123", setupKey: "x" });
  assert.equal(badPassword.ok, false);

  const ok = parseSuperAdminInitializePayload({ email: "A@A.com", password: "12345678", setupKey: "key" });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.email, "a@a.com");
});

test("validateSuperAdminSetupKey valida key esperada", () => {
  const missing = validateSuperAdminSetupKey({ setupKey: "x", expectedSetupKey: undefined });
  assert.equal(missing.ok, false);

  const mismatch = validateSuperAdminSetupKey({ setupKey: "x", expectedSetupKey: "y" });
  assert.equal(mismatch.ok, false);

  const ok = validateSuperAdminSetupKey({ setupKey: "x", expectedSetupKey: "x" });
  assert.equal(ok.ok, true);
});

test("validateBootstrapConfirmPayload valida correo autenticado", () => {
  const missingAuth = validateBootstrapConfirmPayload({ authEmail: "", confirmEmail: "a@a.com" });
  assert.equal(missingAuth.ok, false);

  const mismatch = validateBootstrapConfirmPayload({ authEmail: "a@a.com", confirmEmail: "b@b.com" });
  assert.equal(mismatch.ok, false);

  const ok = validateBootstrapConfirmPayload({ authEmail: "a@a.com", confirmEmail: "a@a.com" });
  assert.equal(ok.ok, true);
});
