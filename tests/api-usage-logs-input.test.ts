import test from "node:test";
import assert from "node:assert/strict";
import { parseUsageLogsCreateBody, parseUsageLogsGetParams } from "../src/lib/api/usageLogsInput";

test("parseUsageLogsGetParams requiere entity_id y limita limit", () => {
  const bad = parseUsageLogsGetParams(new URL("http://localhost/api/usage-logs?limit=999"));
  assert.equal(bad.ok, false);

  const ok = parseUsageLogsGetParams(new URL("http://localhost/api/usage-logs?entity_id=e1&limit=999"));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.entityId, "e1");
    assert.equal(ok.limit, 100);
  }
});

test("parseUsageLogsCreateBody valida entity_id y value", () => {
  const bad = parseUsageLogsCreateBody({ entity_id: "e1", value: "x" });
  assert.equal(bad.ok, false);

  const ok = parseUsageLogsCreateBody({ entity_id: "e1", value: "12.5" });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.entityId, "e1");
    assert.equal(ok.value, 12.5);
    assert.ok(typeof ok.loggedAt === "string");
  }
});
