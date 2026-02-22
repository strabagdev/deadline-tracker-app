import { parseDeadlineCreateIds, parseDeadlineCreatePayload } from "./deadlinesInput";
import { normalizeDeadlinesMode, numOrNaN } from "./deadlinesComputations";

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

type ExistingDeadlineRow = {
  id: string;
  entity_id: string;
  deadline_type_id: string;
  usage_daily_average_mode: string | null;
};

export type DeadlinesRepo = {
  getDeadlineById: (orgId: string, id: string) => Promise<ExistingDeadlineRow | null>;
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
  updateDeadline: (orgId: string, id: string, patch: Record<string, string | number | null>) => Promise<void>;
  deleteDeadline: (orgId: string, id: string) => Promise<void>;
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
    return { status: 201, body: { id: created.id, entity_id: entityId } };
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

  return { status: 201, body: { id: created.id, entity_id: entityId } };
}

export async function handleDeadlinesPut(orgId: string, rawBody: unknown, repo: DeadlinesRepo): Promise<ServiceResponse> {
  const body = (rawBody ?? {}) as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  if (!id) return { status: 400, body: { error: "id required", code: "BAD_REQUEST" } };

  const existing = await repo.getDeadlineById(orgId, id);
  if (!existing) return { status: 404, body: { error: "not found", code: "DEADLINE_NOT_FOUND" } };

  const entity = await repo.getEntity(orgId, existing.entity_id);
  if (!entity) return { status: 404, body: { error: "entity not found", code: "ENTITY_NOT_FOUND" } };

  const dt = await repo.getDeadlineType(orgId, existing.deadline_type_id);
  if (!dt) return { status: 404, body: { error: "deadline type not found", code: "DEADLINE_TYPE_NOT_FOUND" } };

  const patch: Record<string, string | number | null> = {
    title: dt.name,
    measure_by: dt.measure_by,
  };

  const lastDoneDate = body.last_done_date !== undefined ? (body.last_done_date ? String(body.last_done_date) : null) : undefined;
  if (lastDoneDate !== undefined) patch.last_done_date = lastDoneDate;

  if (dt.measure_by === "date") {
    const nextDueDate = body.next_due_date !== undefined ? (body.next_due_date ? String(body.next_due_date) : null) : undefined;

    if (nextDueDate !== undefined && !nextDueDate) {
      return { status: 400, body: { error: "next_due_date required for type measure_by=date", code: "BAD_REQUEST" } };
    }
    if (nextDueDate !== undefined) patch.next_due_date = nextDueDate;

    patch.last_done_usage = null;
    patch.frequency = null;
    patch.frequency_unit = null;
    patch.usage_daily_average = null;
    patch.usage_daily_average_mode = "manual";

    await repo.updateDeadline(orgId, id, patch);
    return { status: 200, body: { ok: true, entity_id: existing.entity_id } };
  }

  if (!entity.tracks_usage) {
    return {
      status: 400,
      body: { error: "entity does not track usage; cannot update a usage-based deadline", code: "TRACKS_USAGE_FALSE" },
    };
  }

  const mode =
    body.usage_daily_average_mode !== undefined
      ? normalizeDeadlinesMode(body.usage_daily_average_mode)
      : normalizeDeadlinesMode(existing.usage_daily_average_mode);

  const lastDoneUsage = body.last_done_usage !== undefined ? numOrNaN(body.last_done_usage) : NaN;
  const frequency = body.frequency !== undefined ? numOrNaN(body.frequency) : NaN;
  const frequencyUnit = body.frequency_unit !== undefined ? (body.frequency_unit ? String(body.frequency_unit) : "") : undefined;
  const usageDailyAverage = body.usage_daily_average !== undefined ? numOrNaN(body.usage_daily_average) : NaN;

  if (body.last_done_usage !== undefined && !Number.isFinite(lastDoneUsage)) {
    return { status: 400, body: { error: "last_done_usage must be a number", code: "BAD_REQUEST" } };
  }
  if (body.frequency !== undefined && !Number.isFinite(frequency)) {
    return { status: 400, body: { error: "frequency must be a number", code: "BAD_REQUEST" } };
  }
  if (body.frequency_unit !== undefined && !frequencyUnit) {
    return { status: 400, body: { error: "frequency_unit required", code: "BAD_REQUEST" } };
  }

  if (mode === "manual" && body.usage_daily_average_mode !== undefined) {
    if (!Number.isFinite(usageDailyAverage) || usageDailyAverage <= 0) {
      return {
        status: 400,
        body: { error: "usage_daily_average required when switching to usage_daily_average_mode=manual", code: "BAD_REQUEST" },
      };
    }
  }

  patch.usage_daily_average_mode = mode;

  if (body.last_done_usage !== undefined) patch.last_done_usage = lastDoneUsage;
  if (body.frequency !== undefined) patch.frequency = frequency;
  if (body.frequency_unit !== undefined) patch.frequency_unit = frequencyUnit ?? null;
  if (body.usage_daily_average !== undefined) {
    patch.usage_daily_average = Number.isFinite(usageDailyAverage) && usageDailyAverage > 0 ? usageDailyAverage : null;
  }

  await repo.updateDeadline(orgId, id, patch);
  return { status: 200, body: { ok: true, entity_id: existing.entity_id } };
}

export async function handleDeadlinesDelete(orgId: string, id: string, repo: DeadlinesRepo): Promise<ServiceResponse> {
  if (!id) return { status: 400, body: { error: "id required", code: "BAD_REQUEST" } };
  const existing = await repo.getDeadlineById(orgId, id);
  if (!existing) return { status: 404, body: { error: "not found", code: "DEADLINE_NOT_FOUND" } };
  await repo.deleteDeadline(orgId, id);
  return { status: 200, body: { ok: true, entity_id: existing.entity_id } };
}
