import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, canViewUsageCaptureEntityType, getOrgAccess } from "@/lib/server/orgAccess";
import { normalizeEntityTypeName } from "@/lib/usage-capture/slug";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

async function getCardFieldsByEntity(
  db: ReturnType<typeof createDataServerClient>,
  orgId: string,
  entityIds: string[]
) {
  const out: Record<string, Array<{ name: string; value_text: string }>> = {};
  if (entityIds.length === 0) return out;

  const { data: values, error: valuesErr } = await db
    .from("entity_field_values")
    .select("entity_id, entity_field_id, value_text")
    .eq("organization_id", orgId)
    .in("entity_id", entityIds);
  if (valuesErr) throw valuesErr;

  const fieldIds = Array.from(
    new Set(
      (values ?? [])
        .map((row) => String(row.entity_field_id ?? "").trim())
        .filter((id) => id.length > 0)
    )
  );
  if (fieldIds.length === 0) return out;

  const { data: fields, error: fieldsErr } = await db
    .from("entity_fields")
    .select("id, name, show_in_card")
    .eq("organization_id", orgId)
    .in("id", fieldIds)
    .eq("show_in_card", true);
  if (fieldsErr) throw fieldsErr;

  const fieldMap = new Map((fields ?? []).map((f) => [String(f.id), String(f.name ?? "")]));

  for (const row of values ?? []) {
    const fieldId = String(row.entity_field_id ?? "").trim();
    const fieldName = fieldMap.get(fieldId);
    if (!fieldName) continue;
    const valueText = String(row.value_text ?? "").trim();
    if (!valueText) continue;
    const entityId = String(row.entity_id ?? "").trim();
    if (!entityId) continue;
    if (!out[entityId]) out[entityId] = [];
    out[entityId].push({ name: fieldName, value_text: valueText });
  }

  return out;
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
    const allowed = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "usage_capture");
    if (!allowed) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const url = new URL(req.url);
    const entityTypeName = String(url.searchParams.get("entity_type") ?? "").trim();
    if (!entityTypeName) {
      return NextResponse.json({ error: "entity_type required", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data: entityTypes, error: typesErr } = await db
      .from("entity_types")
      .select("id, name")
      .eq("organization_id", access.organizationId);
    if (typesErr) throw typesErr;

    const target = normalizeEntityTypeName(entityTypeName);
    const et = (entityTypes ?? []).find((row) => normalizeEntityTypeName(String(row.name ?? "")) === target);
    if (!et?.id) {
      return NextResponse.json({ error: "entity type not found", code: "ENTITY_TYPE_NOT_FOUND" }, { status: 404 });
    }
    const allowedType = await canViewUsageCaptureEntityType(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      String(et.id)
    );
    if (!allowedType) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const entitiesRes = await db
      .from("entities")
      .select("id, name, usage_unit_id")
      .eq("organization_id", access.organizationId)
      .eq("entity_type_id", et.id)
      .eq("tracks_usage", true)
      .order("name", { ascending: true });
    const entities = entitiesRes.data;
    const entitiesErr = entitiesRes.error;
    if (entitiesErr) throw entitiesErr;

    const unitsWithSuggested = await db
      .from("usage_units")
      .select("id, name, is_active, show_in_usage_records, suggested_values")
      .eq("organization_id", access.organizationId)
      .eq("is_active", true);
    let units = unitsWithSuggested.data as Array<{
      id: string;
      name: string | null;
      is_active: boolean;
      show_in_usage_records?: boolean | null;
      suggested_values?: string[] | null;
    }> | null;
    let unitsErr = unitsWithSuggested.error;
    const unitsErrText = String((unitsErr as { message?: string } | null)?.message ?? "").toLowerCase();
    if (unitsErr && unitsErrText.includes("suggested_values")) {
      const unitsLegacy = await db
        .from("usage_units")
        .select("id, name, is_active, show_in_usage_records")
        .eq("organization_id", access.organizationId)
        .eq("is_active", true);
      units = (unitsLegacy.data ?? []).map((u) => ({ ...u, suggested_values: [] }));
      unitsErr = unitsLegacy.error;
    }
    if (unitsErr) throw unitsErr;
    const entitiesSafe = entities ?? [];
    const unitsSafe = units ?? [];

    const unitIds = Array.from(new Set(entitiesSafe.map((e) => String(e.usage_unit_id ?? "")).filter(Boolean)));
    const entityIds = entitiesSafe.map((e) => String(e.id));
    const cardFieldsByEntity = await getCardFieldsByEntity(db, access.organizationId, entityIds);
    const fieldsByUnit: Record<string, Array<{ id: string; name: string; key: string; field_type: string; options: unknown }>> = {};
    if (unitIds.length > 0) {
      const { data: fields, error: fieldsErr } = await db
        .from("usage_fields")
        .select("id, usage_unit_id, name, key, field_type, options")
        .eq("organization_id", access.organizationId)
        .in("usage_unit_id", unitIds)
        .order("created_at", { ascending: true });
      if (fieldsErr) throw fieldsErr;
      for (const row of fields ?? []) {
        const u = String(row.usage_unit_id);
        if (!fieldsByUnit[u]) fieldsByUnit[u] = [];
        fieldsByUnit[u].push({
          id: String(row.id),
          name: String(row.name ?? ""),
          key: String(row.key ?? ""),
          field_type: String(row.field_type ?? "text"),
          options: row.options ?? null,
        });
      }
    }

    const daysByEntity: Record<string, string[]> = {};
    if (entityIds.length > 0) {
      const { data: daysRows, error: daysErr } = await db
        .from("usage_logs")
        .select("entity_id, logged_on")
        .eq("organization_id", access.organizationId)
        .in("entity_id", entityIds)
        .order("logged_on", { ascending: false });
      if (daysErr) throw daysErr;

      for (const row of daysRows ?? []) {
        const entityId = String(row.entity_id);
        const day = String(row.logged_on ?? "").trim();
        if (!day) continue;
        if (!daysByEntity[entityId]) daysByEntity[entityId] = [];
        if (!daysByEntity[entityId].includes(day)) daysByEntity[entityId].push(day);
      }
    }

    const unitsById = new Map((unitsSafe ?? []).map((u) => [String(u.id), u]));
    const normalizedEntities = (entitiesSafe ?? []).map((e) => {
      const unitId = String(e.usage_unit_id ?? "");
      const unit = unitId ? unitsById.get(unitId) : null;
      return {
        id: String(e.id),
        name: String(e.name),
        usage_unit_id: unitId || null,
        usage_unit_name: unit?.show_in_usage_records === false ? "" : String(unit?.name ?? ""),
        usage_unit_visible: unit?.show_in_usage_records !== false,
        usage_unit_suggested_values: Array.isArray(unit?.suggested_values)
          ? unit?.suggested_values.map((v) => String(v)).filter((v) => v.trim().length > 0)
          : [],
        card_fields: cardFieldsByEntity[String(e.id)] ?? [],
        fields: unitId ? fieldsByUnit[unitId] ?? [] : [],
        logged_days: daysByEntity[String(e.id)] ?? [],
      };
    });

    return NextResponse.json({
      entity_type: {
        id: String(et.id),
        name: String(et.name ?? ""),
        slug: normalizeEntityTypeName(String(et.name ?? "")),
      },
      entities: normalizedEntities,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
