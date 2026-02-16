import test from "node:test";
import assert from "node:assert/strict";
import { validateLogoFile } from "../src/lib/api/platformBrandingInput";

const options = {
  maxBytes: 4 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg"],
  tooLargeMessage: "too large",
  invalidFormatMessage: "bad format",
};

test("validateLogoFile falla sin archivo", () => {
  const res = validateLogoFile(null, options);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.body.code, "BAD_REQUEST");
});

test("validateLogoFile falla con tamaño 0", () => {
  const res = validateLogoFile({ size: 0, type: "image/png" }, options);
  assert.equal(res.ok, false);
});

test("validateLogoFile falla por tamaño máximo", () => {
  const res = validateLogoFile({ size: options.maxBytes + 1, type: "image/png" }, options);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.body.error, "too large");
});

test("validateLogoFile falla por mime type", () => {
  const res = validateLogoFile({ size: 100, type: "image/webp" }, options);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.body.error, "bad format");
});

test("validateLogoFile pasa con datos válidos", () => {
  const res = validateLogoFile({ size: 100, type: "image/png" }, options);
  assert.equal(res.ok, true);
});
