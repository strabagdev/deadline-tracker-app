import test from "node:test";
import assert from "node:assert/strict";
import { handleDashboardGet, type DashboardRepo } from "../src/lib/api/dashboardService";

function repo(overrides?: Partial<DashboardRepo>): DashboardRepo {
  return {
    listEntitiesWithDeadlines: async () => [],
    getLatestUsageByEntity: async () => ({}),
    getRecentUsageLogsByEntity: async () => ({}),
    ...overrides,
  };
}

function isoDays(daysFromNow: number) {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

test("dashboard service responde meta consistente sin entidades", async () => {
  const res = await handleDashboardGet("o1", "owner", repo());
  assert.equal(res.status, 200);
  const meta = res.body.meta as { active_org_id: string; role: string; entity_count_in_org: number };
  assert.equal(meta.active_org_id, "o1");
  assert.equal(meta.role, "owner");
  assert.equal(meta.entity_count_in_org, 0);
});

test("dashboard service computa deadline por fecha", async () => {
  const res = await handleDashboardGet(
    "o1",
    "owner",
    repo({
      listEntitiesWithDeadlines: async () => [
        {
          id: "e1",
          name: "Equipo A",
          created_at: isoDays(-1),
          entity_type_id: "t1",
          tracks_usage: false,
          entity_types: { id: "t1", name: "Tipo" },
          deadlines: [
            {
              id: "d1",
              entity_id: "e1",
              deadline_type_id: "dt1",
              last_done_date: null,
              next_due_date: isoDays(90),
              last_done_usage: null,
              frequency: null,
              frequency_unit: null,
              usage_daily_average: null,
              usage_daily_average_mode: null,
              created_at: isoDays(-2),
              deadline_types: { id: "dt1", name: "ITV", measure_by: "date", requires_document: false, is_active: true },
            },
          ],
        },
      ],
    })
  );

  assert.equal(res.status, 200);
  const entities = res.body.entities as Array<{ deadlines: Array<{ computed: { status: string } }> }>;
  assert.equal(entities[0].deadlines[0].computed.status, "ok");
});

test("dashboard service computa deadline por uso con promedio auto", async () => {
  const nowIso = isoDays(0);
  const res = await handleDashboardGet(
    "o1",
    "owner",
    repo({
      listEntitiesWithDeadlines: async () => [
        {
          id: "e1",
          name: "Equipo A",
          created_at: isoDays(-1),
          entity_type_id: "t1",
          tracks_usage: true,
          entity_types: { id: "t1", name: "Tipo" },
          deadlines: [
            {
              id: "d1",
              entity_id: "e1",
              deadline_type_id: "dt1",
              last_done_date: null,
              next_due_date: null,
              last_done_usage: 100,
              frequency: 60,
              frequency_unit: "km",
              usage_daily_average: null,
              usage_daily_average_mode: "auto",
              created_at: isoDays(-2),
              deadline_types: { id: "dt1", name: "Uso", measure_by: "usage", requires_document: false, is_active: true },
            },
          ],
        },
      ],
      getLatestUsageByEntity: async () => ({ e1: { value: 130, logged_at: nowIso } }),
      getRecentUsageLogsByEntity: async () => ({
        e1: [
          { value: 100, logged_at: isoDays(-5) },
          { value: 150, logged_at: isoDays(0) },
        ],
      }),
    })
  );

  const entities = res.body.entities as Array<{ deadlines: Array<{ computed: { status: string; daily_average_source?: string } }> }>;
  assert.equal(entities[0].deadlines[0].computed.status, "ok");
  assert.equal(entities[0].deadlines[0].computed.daily_average_source, "auto");
});
