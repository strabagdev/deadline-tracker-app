import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess } from "@/lib/server/orgAccess";

type UsageLogRow = {
  id: string;
  entity_id: string;
  value: number | null;
  value_text: string | null;
  logged_on: string;
  logged_at: string;
};

type UsageLogFieldValueRow = {
  usage_log_id: string;
  usage_field_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_boolean: boolean | null;
};

type UsageFieldRow = {
  id: string;
  name: string | null;
  key: string | null;
};

type EntityRow = {
  id: string;
  name: string | null;
  entity_type_id: string | null;
  usage_unit_id: string | null;
};

type EntityTypeRow = {
  id: string;
  name: string | null;
};

type UsageUnitRow = {
  id: string;
  name: string | null;
  show_in_usage_records?: boolean | null;
  suggested_values?: string[] | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [maybe.message, maybe.details, maybe.hint]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0);
    if (parts.length > 0) return parts.join(" | ");
  }
  return "error";
}

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function renderFieldValue(v: UsageLogFieldValueRow) {
  if (v.value_boolean !== null) return v.value_boolean ? "Sí" : "No";
  if (v.value_number !== null) return String(v.value_number);
  if (v.value_date) return v.value_date;
  if (v.value_text) return v.value_text;
  return "—";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }

    const orgId = access.organizationId;
    const canReportsUsage = await canViewModule(db, orgId, access.role, access.memberTypeId, "reports_usage");
    if (!canReportsUsage) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const url = new URL(req.url);
    const entityId = String(url.searchParams.get("entity_id") ?? "all").trim();
    const entityTypeId = String(url.searchParams.get("entity_type_id") ?? "all").trim();
    const usageUnitId = String(url.searchParams.get("usage_unit_id") ?? "all").trim();
    const dateFrom = String(url.searchParams.get("date_from") ?? "").trim();
    const dateTo = String(url.searchParams.get("date_to") ?? "").trim();
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? "10") || 10));

    if (dateFrom && !isIsoDateOnly(dateFrom)) {
      return NextResponse.json({ error: "date_from must be YYYY-MM-DD", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (dateTo && !isIsoDateOnly(dateTo)) {
      return NextResponse.json({ error: "date_to must be YYYY-MM-DD", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json({ error: "date_from must be <= date_to", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data: entitiesData, error: entitiesErr } = await db
      .from("entities")
      .select("id, name, entity_type_id, usage_unit_id")
      .eq("organization_id", orgId);
    if (entitiesErr) throw entitiesErr;

    const entities = (entitiesData ?? []) as EntityRow[];
    const filteredEntities = entities.filter((entity) => {
      if (entityId !== "all" && entity.id !== entityId) return false;
      if (entityTypeId !== "all" && String(entity.entity_type_id ?? "") !== entityTypeId) return false;
      if (usageUnitId !== "all" && String(entity.usage_unit_id ?? "") !== usageUnitId) return false;
      return true;
    });
    const sortedFilteredEntities = filteredEntities
      .slice()
      .sort((a, b) => String(a.name ?? "Entidad").localeCompare(String(b.name ?? "Entidad"), "es", { sensitivity: "base" }));
    const pagedEntities = sortedFilteredEntities.slice(offset, offset + limit);
    const entityIds = pagedEntities.map((entity) => entity.id);
    const entityTypeIds = Array.from(new Set(entities.map((entity) => entity.entity_type_id).filter(Boolean))) as string[];
    const usageUnitIds = Array.from(new Set(entities.map((entity) => entity.usage_unit_id).filter(Boolean))) as string[];

    const [{ data: entityTypesData, error: entityTypesErr }, { data: usageUnitsData, error: usageUnitsErr }] = await Promise.all([
      entityTypeIds.length > 0
        ? db.from("entity_types").select("id, name").eq("organization_id", orgId).in("id", entityTypeIds)
        : Promise.resolve({ data: [], error: null }),
      usageUnitIds.length > 0
        ? db.from("usage_units").select("id, name, show_in_usage_records, suggested_values").eq("organization_id", orgId).in("id", usageUnitIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (entityTypesErr) throw entityTypesErr;
    if (usageUnitsErr) throw usageUnitsErr;

    let logs: UsageLogRow[] = [];
    if (entityIds.length > 0) {
      let query = db
        .from("usage_logs")
        .select("id, entity_id, value, value_text, logged_on, logged_at")
        .eq("organization_id", orgId)
        .in("entity_id", entityIds)
        .order("logged_on", { ascending: true })
        .order("logged_at", { ascending: true });

      if (dateFrom) query = query.gte("logged_on", dateFrom);
      if (dateTo) query = query.lte("logged_on", dateTo);

      const { data: logsData, error: logsErr } = await query;
      if (logsErr) throw logsErr;
      logs = (logsData ?? []) as UsageLogRow[];
    }

    const logIds = logs.map((log) => String(log.id)).filter((value) => value.length > 0);
    const usageFieldValuesByLogId = new Map<string, UsageLogFieldValueRow[]>();
    const usageFieldMetaById = new Map<string, { name: string }>();

    if (logIds.length > 0) {
      const { data: usageFieldValuesData, error: usageFieldValuesErr } = await db
        .from("usage_log_field_values")
        .select("usage_log_id, usage_field_id, value_text, value_number, value_date, value_boolean")
        .eq("organization_id", orgId)
        .in("usage_log_id", logIds);
      if (usageFieldValuesErr) throw usageFieldValuesErr;

      const usageFieldValues = (usageFieldValuesData ?? []) as UsageLogFieldValueRow[];
      const usageFieldIds = Array.from(
        new Set(
          usageFieldValues
            .map((row) => String(row.usage_field_id ?? "").trim())
            .filter((value) => value.length > 0)
        )
      );

      if (usageFieldIds.length > 0) {
        const { data: usageFieldsData, error: usageFieldsErr } = await db
          .from("usage_fields")
          .select("id, name, key")
          .eq("organization_id", orgId)
          .in("id", usageFieldIds);
        if (usageFieldsErr) throw usageFieldsErr;

        for (const field of (usageFieldsData ?? []) as UsageFieldRow[]) {
          usageFieldMetaById.set(String(field.id), {
            name: String(field.name ?? field.key ?? "Campo").trim() || "Campo",
          });
        }
      }

      for (const row of usageFieldValues) {
        const usageLogId = String(row.usage_log_id ?? "").trim();
        if (!usageLogId) continue;
        const current = usageFieldValuesByLogId.get(usageLogId) ?? [];
        current.push(row);
        usageFieldValuesByLogId.set(usageLogId, current);
      }
    }

    const entityTypeById = new Map(((entityTypesData ?? []) as EntityTypeRow[]).map((type) => [type.id, type]));
    const usageUnitById = new Map(((usageUnitsData ?? []) as UsageUnitRow[]).map((unit) => [unit.id, unit]));
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));

    const rows = logs.map((log) => {
      const entity = entityById.get(log.entity_id);
      const entityType = entity?.entity_type_id ? entityTypeById.get(entity.entity_type_id) : null;
      const usageUnit = entity?.usage_unit_id ? usageUnitById.get(entity.usage_unit_id) : null;
      const valueText = String(log.value_text ?? "").trim();
      const valueNumber = log.value != null && Number.isFinite(Number(log.value)) ? Number(log.value) : null;
      return {
        id: log.id,
        entity_id: log.entity_id,
        entity_name: entity?.name ?? "Entidad",
        entity_type_id: entity?.entity_type_id ?? null,
        entity_type_name: entityType?.name ?? "Sin tipo",
        usage_unit_id: entity?.usage_unit_id ?? null,
        usage_unit_name: usageUnit?.name ?? "",
        usage_unit_visible: usageUnit?.show_in_usage_records !== false,
        usage_unit_suggested_values: Array.isArray(usageUnit?.suggested_values)
          ? usageUnit.suggested_values.map((value) => String(value)).filter((value) => value.trim().length > 0)
          : [],
        logged_on: log.logged_on,
        logged_at: log.logged_at,
        value: valueNumber,
        value_text: valueText || null,
        value_display: valueText || (valueNumber != null ? String(valueNumber) : "—"),
        field_values: (usageFieldValuesByLogId.get(String(log.id)) ?? []).map((fieldValue) => ({
          usage_field_id: String(fieldValue.usage_field_id),
          name: usageFieldMetaById.get(String(fieldValue.usage_field_id))?.name ?? "Campo",
          value: renderFieldValue(fieldValue),
        })),
      };
    });

    return NextResponse.json({
      filters: {
        entity_id: entityId,
        entity_type_id: entityTypeId,
        usage_unit_id: usageUnitId,
        date_from: dateFrom || null,
        date_to: dateTo || null,
        offset,
        limit,
      },
      paging: {
        offset,
        limit,
        total_entities: sortedFilteredEntities.length,
        loaded_entities: pagedEntities.length,
        has_more: offset + pagedEntities.length < sortedFilteredEntities.length,
      },
      options: {
        entities: entities
          .map((entity) => ({ id: entity.id, name: entity.name ?? "Entidad" }))
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
        entity_types: ((entityTypesData ?? []) as EntityTypeRow[])
          .map((type) => ({ id: type.id, name: type.name ?? "Sin tipo" }))
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
        usage_units: ((usageUnitsData ?? []) as UsageUnitRow[])
          .map((unit) => ({ id: unit.id, name: unit.name ?? "Sin unidad" }))
          .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
      },
      entity_rows: pagedEntities
        .map((entity) => {
          const entityType = entity.entity_type_id ? entityTypeById.get(entity.entity_type_id) : null;
          const usageUnit = entity.usage_unit_id ? usageUnitById.get(entity.usage_unit_id) : null;
          return {
            id: entity.id,
            name: entity.name ?? "Entidad",
            entity_type_name: entityType?.name ?? "Sin tipo",
            usage_unit_name: usageUnit?.name ?? "",
            usage_unit_visible: usageUnit?.show_in_usage_records !== false,
            usage_unit_suggested_values: Array.isArray(usageUnit?.suggested_values)
              ? usageUnit.suggested_values.map((value) => String(value)).filter((value) => value.trim().length > 0)
              : [],
          };
        }),
      rows,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
