import { parseDeadlineCreateIds, parseDeadlineCreatePayload } from "./deadlinesInput";

type MeasureBy = "date" | "usage";

type DeadlineTypeRow = {
  id: string;
  name: string;
  measure_by: MeasureBy;
  is_active: boolean;
};

type EntityRow = {
  id: string;
  tracks_usage: boolean;
};

export type DeadlinesRepo = {
  getEntity: (orgId: string, entityId: string) => Promise<EntityRow | null>;
  getDeadlineType: (orgId: string, deadlineTypeId: string) => Promise<DeadlineTypeRow | null>;
  createDateDeadline: (
    orgId: string,
    input: {
      entityId: string;
      deadlineTypeId: string;
      legacyTitle: string;
      legacyMeasureBy: MeasureBy;
      lastDoneDate: string | null;
      nextDueDate: string;
    }
  ) => Promise<{ id: string }>;
  createUsageDeadline: (
    orgId: string,
    input: {
      entityId: string;
      deadlineTypeId: string;
      legacyTitle: string;
      legacyMeasureBy: MeasureBy;
      lastDoneDate: string | null;
      lastDoneUsage: number;
      frequency: number;
      frequencyUnit: string;
      mode: "manual" | "auto";
      usageDailyAverage: number | null;
    }
  ) => Promise<{ id: string }>;
};

type ServiceResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function handleDeadlinesPost(orgId: string, rawBody: unknown, repo: DeadlinesRepo): Promise<ServiceResponse> {
  const ids = parseDeadlineCreateIds(rawBody);
  if (!ids.ok) return { status: ids.status, body: ids.body };

  const { entityId, deadlineTypeId } = ids;
  const entity = await repo.getEntity(orgId, entityId);
  if (!entity) return { status: 404, body: { error: "entity not found", code: "ENTITY_NOT_FOUND" } };

  const dt = await repo.getDeadlineType(orgId, deadlineTypeId);
  if (!dt) return { status: 404, body: { error: "deadline type not found", code: "DEADLINE_TYPE_NOT_FOUND" } };
  if (!dt.is_active) return { status: 400, body: { error: "deadline type is inactive", code: "DEADLINE_TYPE_INACTIVE" } };

  const parsed = parseDeadlineCreatePayload(rawBody, { measureBy: dt.measure_by, tracksUsage: entity.tracks_usage });
  if (!parsed.ok) return { status: parsed.status, body: parsed.body };

  const legacyTitle = dt.name;
  const legacyMeasureBy = dt.measure_by;

  if (parsed.measureBy === "date") {
    const created = await repo.createDateDeadline(orgId, {
      entityId,
      deadlineTypeId,
      legacyTitle,
      legacyMeasureBy,
      lastDoneDate: parsed.lastDoneDate,
      nextDueDate: parsed.nextDueDate,
    });
    return { status: 201, body: { id: created.id } };
  }

  const created = await repo.createUsageDeadline(orgId, {
    entityId,
    deadlineTypeId,
    legacyTitle,
    legacyMeasureBy,
    lastDoneDate: parsed.lastDoneDate,
    lastDoneUsage: parsed.lastDoneUsage,
    frequency: parsed.frequency,
    frequencyUnit: parsed.frequencyUnit,
    mode: parsed.mode,
    usageDailyAverage: parsed.usageDailyAverage,
  });

  return { status: 201, body: { id: created.id } };
}
