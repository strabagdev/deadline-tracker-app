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

type EntityRow = {
  id: string;
  name: string;
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
};

type EntityFieldValueRow = {
  entity_id: string;
  entity_field_id: string;
  value_text: string | null;
};

type EntityFieldRow = {
  id: string;
  name: string | null;
  key: string | null;
  created_at: string | null;
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
  field_type: string | null;
  created_at: string | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as {
      message?: unknown;
      error?: unknown;
      error_description?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const parts = [maybe.message, maybe.error, maybe.error_description, maybe.details, maybe.hint]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0);
    if (parts.length > 0) return parts.join(" | ");
  }
  return "error";
}

function renderFieldValue(v: UsageLogFieldValueRow) {
  if (v.value_boolean !== null) return v.value_boolean ? "Sí" : "No";
  if (v.value_number !== null) return String(v.value_number);
  if (v.value_date) return v.value_date;
  if (v.value_text) return v.value_text;
  return "—";
}

function isIsoDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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
    const entityTypeId = String(url.searchParams.get("entity_type_id") ?? "all").trim();
    const dateFrom = String(url.searchParams.get("date_from") ?? "").trim();
    const dateTo = String(url.searchParams.get("date_to") ?? "").trim();
    const viewMode = String(url.searchParams.get("view_mode") ?? "detail").trim().toLowerCase();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 1000), 1), 5000);
    const includeFieldDetails = viewMode !== "timeline";

    if (dateFrom && !isIsoDateOnly(dateFrom)) {
      return NextResponse.json({ error: "date_from must be YYYY-MM-DD", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (dateTo && !isIsoDateOnly(dateTo)) {
      return NextResponse.json({ error: "date_to must be YYYY-MM-DD", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      return NextResponse.json({ error: "date_from must be <= date_to", code: "BAD_REQUEST" }, { status: 400 });
    }

    let query = db
      .from("usage_logs")
      .select("id, entity_id, value, value_text, logged_on, logged_at")
      .eq("organization_id", orgId)
      .order("logged_on", { ascending: false })
      .order("logged_at", { ascending: false })
      .limit(limit);

    if (dateFrom) query = query.gte("logged_on", dateFrom);
    if (dateTo) query = query.lte("logged_on", dateTo);

    const { data, error } = await query;
    if (error) throw error;

    const usageLogs = (data ?? []) as UsageLogRow[];
    const usageLogIds = usageLogs.map((row) => String(row.id)).filter((value) => value.length > 0);
    const entityIds = Array.from(new Set(usageLogs.map((row) => String(row.entity_id)).filter((value) => value.length > 0)));

    const { data: entitiesData, error: entitiesErr } = entityIds.length
      ? await db
          .from("entities")
          .select("id, name, entity_type_id, usage_unit_id")
          .eq("organization_id", orgId)
          .in("id", entityIds)
      : { data: [], error: null };
    if (entitiesErr) throw entitiesErr;

    const entities = (entitiesData ?? []) as EntityRow[];
    const entitiesById = new Map(entities.map((row) => [String(row.id), row]));

    const filteredEntityIds =
      entityTypeId && entityTypeId !== "all"
        ? entities.filter((row) => String(row.entity_type_id ?? "") === entityTypeId).map((row) => String(row.id))
        : entityIds;

    const filteredEntityIdSet = new Set(filteredEntityIds);
    const filteredUsageLogs = usageLogs.filter((row) => filteredEntityIdSet.has(String(row.entity_id)));

    const filteredUsageLogIds = filteredUsageLogs.map((row) => String(row.id)).filter((value) => value.length > 0);
    const filteredEntityIdsUnique = Array.from(new Set(filteredUsageLogs.map((row) => String(row.entity_id)).filter((value) => value.length > 0)));

    const entityTypeIds = Array.from(
      new Set(
        entities
          .map((row) => String(row.entity_type_id ?? "").trim())
          .filter((value) => value.length > 0)
      )
    );
    const usageUnitIds = Array.from(
      new Set(
        entities
          .map((row) => String(row.usage_unit_id ?? "").trim())
          .filter((value) => value.length > 0)
      )
    );

    const [{ data: entityTypesData, error: entityTypesErr }, { data: usageUnitsData, error: usageUnitsErr }] = await Promise.all([
      entityTypeIds.length > 0
        ? db.from("entity_types").select("id, name").eq("organization_id", orgId).in("id", entityTypeIds)
        : Promise.resolve({ data: [], error: null }),
      usageUnitIds.length > 0
        ? db.from("usage_units").select("id, name, show_in_usage_records").eq("organization_id", orgId).in("id", usageUnitIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (entityTypesErr) throw entityTypesErr;
    if (usageUnitsErr) throw usageUnitsErr;

    const entityTypeById = new Map(((entityTypesData ?? []) as EntityTypeRow[]).map((row) => [String(row.id), row]));
    const usageUnitById = new Map(((usageUnitsData ?? []) as UsageUnitRow[]).map((row) => [String(row.id), row]));

    const entityProfileByEntityId: Record<string, Array<{ entity_field_id: string; name: string; value: string }>> = {};
    const entityFieldMetaById = new Map<string, { name: string; created_at: string }>();
    if (includeFieldDetails && filteredEntityIdsUnique.length > 0) {
      const { data: entityFieldValuesData, error: entityFieldValuesErr } = await db
        .from("entity_field_values")
        .select("entity_id, entity_field_id, value_text")
        .eq("organization_id", orgId)
        .in("entity_id", filteredEntityIdsUnique);
      if (entityFieldValuesErr) throw entityFieldValuesErr;

      const entityFieldValues = (entityFieldValuesData ?? []) as EntityFieldValueRow[];
      const entityFieldIds = Array.from(
        new Set(
          entityFieldValues
            .map((row) => String(row.entity_field_id ?? "").trim())
            .filter((value) => value.length > 0)
        )
      );
      const { data: entityFieldsData, error: entityFieldsErr } = entityFieldIds.length
        ? await db
            .from("entity_fields")
            .select("id, name, key, created_at")
            .eq("organization_id", orgId)
            .in("id", entityFieldIds)
        : { data: [], error: null };
      if (entityFieldsErr) throw entityFieldsErr;

      const entityFieldById = new Map(((entityFieldsData ?? []) as EntityFieldRow[]).map((row) => [String(row.id), row]));

      for (const row of entityFieldValues) {
        const value = String(row.value_text ?? "").trim();
        if (!value) continue;
        const entityFieldId = String(row.entity_field_id ?? "").trim();
        if (!entityFieldId) continue;
        const field = entityFieldById.get(entityFieldId);
        const name = String(field?.name ?? field?.key ?? "").trim();
        if (!name) continue;
        entityFieldMetaById.set(entityFieldId, { name, created_at: String(field?.created_at ?? "") });
        const entityId = String(row.entity_id ?? "").trim();
        if (!entityId) continue;
        if (!entityProfileByEntityId[entityId]) entityProfileByEntityId[entityId] = [];
        entityProfileByEntityId[entityId].push({ entity_field_id: entityFieldId, name, value });
      }
    }

    const usageFieldMetaById = new Map<string, { name: string; created_at: string }>();
    const usageFieldValuesByLogId = new Map<string, UsageLogFieldValueRow[]>();
    if (includeFieldDetails && filteredUsageLogIds.length > 0) {
      const { data: usageFieldValuesData, error: usageFieldValuesErr } = await db
        .from("usage_log_field_values")
        .select("usage_log_id, usage_field_id, value_text, value_number, value_date, value_boolean")
        .eq("organization_id", orgId)
        .in("usage_log_id", filteredUsageLogIds);
      if (usageFieldValuesErr) throw usageFieldValuesErr;

      const usageFieldValues = (usageFieldValuesData ?? []) as UsageLogFieldValueRow[];
      const usageFieldIds = Array.from(
        new Set(
          usageFieldValues
            .map((row) => String(row.usage_field_id ?? "").trim())
            .filter((value) => value.length > 0)
        )
      );
      const { data: usageFieldsData, error: usageFieldsErr } = usageFieldIds.length
        ? await db
            .from("usage_fields")
            .select("id, name, key, field_type, created_at")
            .eq("organization_id", orgId)
            .in("id", usageFieldIds)
        : { data: [], error: null };
      if (usageFieldsErr) throw usageFieldsErr;

      const usageFieldById = new Map(((usageFieldsData ?? []) as UsageFieldRow[]).map((row) => [String(row.id), row]));

      for (const row of usageFieldValues) {
        const usageLogId = String(row.usage_log_id ?? "").trim();
        if (!usageLogId) continue;
        const usageFieldId = String(row.usage_field_id ?? "").trim();
        if (!usageFieldId) continue;
        const field = usageFieldById.get(usageFieldId);
        const fieldName = String(field?.name ?? field?.key ?? "Campo").trim();
        usageFieldMetaById.set(usageFieldId, { name: fieldName, created_at: String(field?.created_at ?? "") });
        const current = usageFieldValuesByLogId.get(usageLogId) ?? [];
        current.push(row);
        usageFieldValuesByLogId.set(usageLogId, current);
      }
    }

    const rows = filteredUsageLogs.map((row) => {
      const entity = entitiesById.get(String(row.entity_id));
      const entityType = entity?.entity_type_id ? entityTypeById.get(String(entity.entity_type_id)) : null;
      const unit = entity?.usage_unit_id ? usageUnitById.get(String(entity.usage_unit_id)) : null;
      const showUnit = Boolean(unit?.id) && unit?.show_in_usage_records !== false;
      const mainValueText = String(row.value_text ?? "").trim();
      const mainValueNumber = row.value != null && Number.isFinite(Number(row.value)) ? Number(row.value) : null;
      const mainValue = mainValueText || (mainValueNumber != null ? String(mainValueNumber) : "—");
      const fieldValues = includeFieldDetails
        ? (usageFieldValuesByLogId.get(String(row.id)) ?? []).map((valueRow) => {
            const usageFieldId = String(valueRow.usage_field_id);
            const fieldMeta = usageFieldMetaById.get(usageFieldId);
            return {
              usage_field_id: usageFieldId,
              name: String(fieldMeta?.name ?? "Campo"),
              value: renderFieldValue(valueRow),
            };
          })
        : [];
      return {
        id: String(row.id),
        entity_id: String(row.entity_id),
        entity_name: String(entity?.name ?? "Entidad"),
        entity_type_id: entity?.entity_type_id ? String(entity.entity_type_id) : null,
        entity_type_name: String(entityType?.name ?? "Sin tipo"),
        usage_unit_name: showUnit ? String(unit?.name ?? "") : "",
        usage_unit_visible: showUnit,
        logged_on: String(row.logged_on),
        logged_at: String(row.logged_at),
        value: mainValueNumber,
        value_text: mainValueText || null,
        value_display: mainValue,
        entity_profile_values: includeFieldDetails ? entityProfileByEntityId[String(row.entity_id)] ?? [] : [],
        field_values: fieldValues,
      };
    });

    const entityTypeOptions = Array.from(
      new Map(
        rows
          .filter((row) => row.entity_type_id)
          .map((row) => [String(row.entity_type_id), String(row.entity_type_name || "Sin tipo")])
      ).entries()
    )
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

    return NextResponse.json({
      meta: {
        active_org_id: orgId,
        count: rows.length,
        generated_at: new Date().toISOString(),
      },
      filters: {
        entity_type_id: entityTypeId || "all",
        date_from: dateFrom || null,
        date_to: dateTo || null,
      },
      entity_type_options: entityTypeOptions,
      column_order: {
        entity_profile_columns: includeFieldDetails
          ? Array.from(entityFieldMetaById.entries())
          .map(([id, meta]) => ({ id, name: meta.name, created_at: meta.created_at }))
          .sort((a, b) => {
            const ad = Date.parse(a.created_at || "");
            const bd = Date.parse(b.created_at || "");
            if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return ad - bd;
            return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
          })
          : [],
        usage_field_columns: includeFieldDetails
          ? Array.from(usageFieldMetaById.entries())
          .map(([id, meta]) => ({ id, name: meta.name, created_at: meta.created_at }))
          .sort((a, b) => {
            const ad = Date.parse(a.created_at || "");
            const bd = Date.parse(b.created_at || "");
            if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return ad - bd;
            return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
          })
          : [],
      },
      rows,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
