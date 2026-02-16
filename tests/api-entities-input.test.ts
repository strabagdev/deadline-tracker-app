import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFieldValues, parseEntityCreateBody } from "../src/lib/api/entitiesInput";

test("parseEntityCreateBody valida nombre y tipo", () => {
  const bad = parseEntityCreateBody({});
  assert.equal(bad.ok, false);

  const ok = parseEntityCreateBody({
    name: "Compresor A",
    entity_type_id: "type-1",
    tracks_usage: true,
    field_values: [],
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.name, "Compresor A");
    assert.equal(ok.entityTypeId, "type-1");
    assert.equal(ok.tracksUsage, true);
  }
});

test("normalizeFieldValues filtra vacios y trimea", () => {
  const rows = normalizeFieldValues([
    { entity_field_id: "f1", value_text: "  abc  " },
    { entity_field_id: "f2", value_text: "   " },
    { entity_field_id: "", value_text: "x" },
  ]);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { entity_field_id: "f1", value_text: "abc" });
});
