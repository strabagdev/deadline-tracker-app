import {
  computeAutoDailyAverageFromList,
  computeDateComputed,
  computeUsageComputed,
  normalizeDashboardMode,
  type UsageDailyAverageMode,
  type UsageLogPoint,
} from "./dashboardComputations";

type MeasureBy = "date" | "usage";

type LatestUsage = { value: number; logged_at: string };

type DashboardDeadlineRow = {
  id: string;
  entity_id: string;
  deadline_type_id: string;
  last_done_date: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_daily_average_mode: string | null;
  created_at: string;
  deadline_types?: {
    id: string;
    name: string;
    measure_by: MeasureBy;
    requires_document: boolean;
    is_active: boolean;
  } | null;
  measure_by?: MeasureBy | null;
};

type DashboardEntityRow = {
  id: string;
  name: string;
  created_at: string;
  entity_type_id: string | null;
  tracks_usage: boolean;
  entity_types?: { id: string; name: string } | null;
  deadlines?: DashboardDeadlineRow[] | null;
};

type DashboardCardField = {
  name: string;
  value_text: string;
  show_in_card: boolean;
  created_at: string | null;
};

type ComputedDashboardDeadline = DashboardDeadlineRow & {
  computed?: ReturnType<typeof computeDateComputed> | ReturnType<typeof computeUsageComputed> | { status: "incomplete"; reason: string };
  __tmp_usage?: { mode: UsageDailyAverageMode; manualAvg: number | null };
};

type ComputedDashboardEntity = Omit<DashboardEntityRow, "deadlines"> & {
  deadlines: ComputedDashboardDeadline[];
  current_usage?: number | null;
  current_usage_logged_at?: string | null;
  auto_usage_daily_average?: number | null;
  card_fields?: Array<{ name: string; value_text: string }>;
};

export type DashboardRepo = {
  listEntitiesWithDeadlines: (orgId: string) => Promise<DashboardEntityRow[]>;
  getLatestUsageByEntity: (orgId: string, entityIds: string[]) => Promise<Record<string, LatestUsage>>;
  getRecentUsageLogsByEntity: (orgId: string, entityIds: string[], sinceIso: string) => Promise<Record<string, UsageLogPoint[]>>;
  getCardFieldsByEntity: (orgId: string, entityIds: string[]) => Promise<Record<string, DashboardCardField[]>>;
};

type ServiceResponse = {
  status: number;
  body: Record<string, unknown>;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function handleDashboardGet(
  orgId: string,
  role: string,
  repo: DashboardRepo
): Promise<ServiceResponse> {
  const entityRows = await repo.listEntitiesWithDeadlines(orgId);
  const entityIds = entityRows.map((e) => e.id);

  const logsByEntity: Record<string, UsageLogPoint[]> = {};
  const latestUsageByEntity: Record<string, LatestUsage> = {};
  const cardFieldsByEntity: Record<string, DashboardCardField[]> = {};

  if (entityIds.length > 0) {
    Object.assign(latestUsageByEntity, await repo.getLatestUsageByEntity(orgId, entityIds));
    Object.assign(cardFieldsByEntity, await repo.getCardFieldsByEntity(orgId, entityIds));

    const since = new Date(Date.now() - 30 * MS_PER_DAY).toISOString();
    Object.assign(logsByEntity, await repo.getRecentUsageLogsByEntity(orgId, entityIds, since));
  }

  const computedEntities = entityRows.map((entity): ComputedDashboardEntity => {
    const latest = latestUsageByEntity[entity.id] ?? null;

    const deadlines = (entity.deadlines ?? []).map((d): ComputedDashboardDeadline => {
      const measureBy = (d?.deadline_types?.measure_by ?? d?.measure_by) as MeasureBy | undefined;
      if (!measureBy) return { ...d, computed: { status: "incomplete", reason: "missing_measure_by" } };

      if (measureBy === "date") {
        return { ...d, computed: computeDateComputed(d?.next_due_date ?? null) };
      }

      if (!entity.tracks_usage) {
        return { ...d, computed: { status: "incomplete", reason: "tracks_usage_false" } };
      }

      const mode = normalizeDashboardMode(d?.usage_daily_average_mode);
      const manualAvg = Number.isFinite(Number(d?.usage_daily_average)) ? Number(d.usage_daily_average) : null;

      return {
        ...d,
        __tmp_usage: { mode, manualAvg },
      };
    });

    const cardFields = (cardFieldsByEntity[entity.id] ?? [])
      .filter((f) => f.show_in_card && String(f.value_text ?? "").trim() !== "")
      .sort((a, b) => {
        const aTs = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTs = b.created_at ? new Date(b.created_at).getTime() : 0;
        return aTs - bTs;
      })
      .map((f) => ({ name: f.name, value_text: String(f.value_text ?? "").trim() }));

    return {
      ...entity,
      deadlines,
      current_usage: latest?.value ?? null,
      current_usage_logged_at: latest?.logged_at ?? null,
      card_fields: cardFields,
    };
  });

  for (const entity of computedEntities) {
    const latest = latestUsageByEntity[entity.id] ?? null;
    const autoAvg = await computeAutoDailyAverageFromList(logsByEntity[entity.id] ?? []);

    entity.deadlines = (entity.deadlines ?? []).map((d) => {
      if (!d?.__tmp_usage) return d;

      const mode = d.__tmp_usage.mode as UsageDailyAverageMode;
      const manualAvg = d.__tmp_usage.manualAvg as number | null;

      const computed = computeUsageComputed({
        latestUsage: latest ? Number(latest.value) : null,
        latestLoggedAt: latest ? String(latest.logged_at) : null,
        lastDoneUsage: d?.last_done_usage ?? null,
        frequency: d?.frequency ?? null,
        mode,
        manualAvg,
        autoAvg,
      });

      const cleaned = { ...d };
      delete cleaned.__tmp_usage;
      return { ...cleaned, computed };
    });

    entity.auto_usage_daily_average = autoAvg ?? null;
  }

  return {
    status: 200,
    body: {
      meta: { active_org_id: orgId, role, entity_count_in_org: entityRows.length },
      entities: computedEntities,
      latest_usage_by_entity: latestUsageByEntity,
    },
  };
}
