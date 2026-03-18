import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import { parseCsv } from "@/lib/csv/simpleCsv";
import { buildDuplicateEntityNameMessage, isDuplicateEntityNameError } from "@/lib/api/entityNameConflicts";

type ParsedRow = {
  line: number;
  entityId: string | null;
  name: string;
  entityTypeName: string;
  tracksUsage: boolean | null;
  tracksUsageProvided: boolean;
  usageUnitId: string | null;
  usageUnitProvided: boolean;
  fields: Record<string, string>;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function normalizeHeader(value: string): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\u00A0/g, " ")
    .trim()
    .toLowerCase();
}

function canonicalHeader(value: string): string {
  return normalizeHeader(value)
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getHeaderIndex(indexByHeader: Map<string, number>, aliases: string[]): number {
  for (const alias of aliases) {
    const idx = indexByHeader.get(canonicalHeader(alias));
    if (typeof idx === "number") return idx;
  }
  return -1;
}

function buildHeaderIndex(headers: string[]): Map<string, number> {
  const out = new Map<string, number>();
  headers.forEach((h, i) => out.set(canonicalHeader(h), i));
  return out;
}

function detectHeaderRow(matrix: string[][]): { rowIndex: number; headers: string[]; indexByHeader: Map<string, number> } {
  const probeLimit = Math.min(matrix.length, 8);
  for (let i = 0; i < probeLimit; i++) {
    const headers = (matrix[i] ?? []).map((h) => String(h ?? "").replace(/^\uFEFF/, "").trim());
    const indexByHeader = buildHeaderIndex(headers);
    const hasName = getHeaderIndex(indexByHeader, ["entity_name", "name"]) >= 0;
    const hasEntityId = getHeaderIndex(indexByHeader, ["entity_id", "id"]) >= 0;
    if (hasName || hasEntityId) {
      return { rowIndex: i, headers, indexByHeader };
    }
  }
  const fallbackHeaders = (matrix[0] ?? []).map((h) => String(h ?? "").replace(/^\uFEFF/, "").trim());
  return { rowIndex: 0, headers: fallbackHeaders, indexByHeader: buildHeaderIndex(fallbackHeaders) };
}

function parseBool(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "y", "si", "sí"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: Request) {
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
    const canEntities = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "entities");
    if (!canEntities || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    const orgId = access.organizationId;

    const body = await req.json().catch(() => ({}));
    const csv = String(body?.csv ?? "");
    const apply = Boolean(body?.apply ?? false);
    const importModeRaw = String(body?.import_mode ?? "update").trim().toLowerCase();
    const importMode = importModeRaw === "create" ? "create" : importModeRaw === "update" ? "update" : null;
    const selectedEntityTypeId = String(body?.entity_type_id ?? "").trim();
    if (!importMode) {
      return NextResponse.json({ error: "import_mode inválido (update|create)", code: "INVALID_INPUT" }, { status: 400 });
    }

    if (!csv.trim()) {
      return NextResponse.json({ error: "csv is required", code: "INVALID_INPUT" }, { status: 400 });
    }

    const matrix = parseCsv(csv);
    if (matrix.length < 2) {
      return NextResponse.json({ error: "CSV vacío o sin filas de datos", code: "INVALID_INPUT" }, { status: 400 });
    }
    if (matrix.length > 2001) {
      return NextResponse.json({ error: "Máximo 2000 filas por carga", code: "TOO_MANY_ROWS" }, { status: 400 });
    }

    const detected = detectHeaderRow(matrix);
    const headers = detected.headers;
    const indexByHeader = detected.indexByHeader;

    const requiredGroups = importMode === "update"
      ? [
          { label: "entity_id", aliases: ["entity_id", "id"] },
          { label: "entity_name", aliases: ["entity_name", "name", "entity_name"] },
        ]
      : [{ label: "entity_name", aliases: ["entity_name", "name"] }];
    for (const group of requiredGroups) {
      if (getHeaderIndex(indexByHeader, group.aliases) < 0) {
        return NextResponse.json(
          { error: `Falta columna requerida: ${group.label}`, code: "INVALID_HEADER" },
          { status: 400 }
        );
      }
    }

    const entityIdIdx = getHeaderIndex(indexByHeader, ["entity_id", "id"]);
    const nameIdx = getHeaderIndex(indexByHeader, ["entity_name", "name"]);
    const typeIdx = getHeaderIndex(indexByHeader, ["entity_type", "type"]);
    const tracksUsageIdx = getHeaderIndex(indexByHeader, ["tracks_usage", "uses_usage", "registrar_uso"]);
    const usageUnitNameIdx = getHeaderIndex(indexByHeader, ["usage_unit", "unit", "usage_unit_name"]);
    const usageUnitIdIdx = getHeaderIndex(indexByHeader, ["usage_unit_id", "unit_id"]);

    const fieldColumns = headers
      .map((h, i) => ({ h, i }))
      .map(({ h, i }) => ({
        raw: h.replace(/^\uFEFF/, "").trim(),
        index: i,
      }))
      .filter(({ raw }) => /^field(?:[:\s_-]|$)/i.test(raw))
      .map(({ raw, index }) => ({
        key: raw.replace(/^field[:\s_-]*/i, "").trim(),
        index,
      }))
      .filter((v) => v.key.length > 0);

    const [
      { data: types, error: typeErr },
      { data: fields, error: fieldErr },
      { data: entities, error: entErr },
      { data: usageUnits, error: usageUnitsErr },
    ] =
      await Promise.all([
        db.from("entity_types").select("id, name").eq("organization_id", orgId),
        db.from("entity_fields").select("id, entity_type_id, key").eq("organization_id", orgId),
        db.from("entities").select("id, entity_type_id").eq("organization_id", orgId),
        db.from("usage_units").select("id, name").eq("organization_id", orgId).eq("is_active", true),
      ]);
    if (typeErr) throw typeErr;
    if (fieldErr) throw fieldErr;
    if (entErr) throw entErr;
    if (usageUnitsErr) throw usageUnitsErr;

    const typeByName = new Map<string, { id: string; name: string }>();
    for (const t of (types ?? []) as Array<{ id: string; name: string }>) {
      typeByName.set(t.name.trim().toLowerCase(), t);
    }
    const selectedType =
      selectedEntityTypeId
        ? ((types ?? []) as Array<{ id: string; name: string }>).find((t) => t.id === selectedEntityTypeId) ?? null
        : null;
    if (selectedEntityTypeId && !selectedType) {
      return NextResponse.json({ error: "entity_type_id inválido", code: "INVALID_ENTITY_TYPE" }, { status: 400 });
    }

    const fieldByTypeAndKey = new Map<string, { id: string }>();
    for (const f of (fields ?? []) as Array<{ id: string; entity_type_id: string; key: string }>) {
      fieldByTypeAndKey.set(`${f.entity_type_id}::${String(f.key).trim()}`, { id: f.id });
    }

    const entityTypeById = new Map<string, string>();
    for (const e of (entities ?? []) as Array<{ id: string; entity_type_id: string }>) {
      entityTypeById.set(e.id, e.entity_type_id);
    }
    const usageUnitById = new Map<string, { id: string; name: string }>();
    const usageUnitByName = new Map<string, { id: string; name: string }>();
    for (const u of (usageUnits ?? []) as Array<{ id: string; name: string }>) {
      usageUnitById.set(u.id, u);
      usageUnitByName.set(String(u.name ?? "").trim().toLowerCase(), u);
    }

    const errors: Array<{ line: number; message: string }> = [];
    const parsed: ParsedRow[] = [];

    for (let r = detected.rowIndex + 1; r < matrix.length; r++) {
      const lineNo = r + 1;
      const row = matrix[r] ?? [];

      const entityId = entityIdIdx >= 0 ? String(row[entityIdIdx] ?? "").trim() : "";
      const name = String(row[nameIdx] ?? "").trim();
      const typeNameRaw = typeIdx >= 0 ? String(row[typeIdx] ?? "").trim() : "";
      const typeName = typeNameRaw || selectedType?.name || "";
      const tracksRaw = tracksUsageIdx >= 0 ? String(row[tracksUsageIdx] ?? "").trim() : "";
      const usageUnitNameRaw = usageUnitNameIdx >= 0 ? String(row[usageUnitNameIdx] ?? "").trim() : "";
      const usageUnitIdRaw = usageUnitIdIdx >= 0 ? String(row[usageUnitIdIdx] ?? "").trim() : "";

      if (!name) errors.push({ line: lineNo, message: "entity_name requerido" });
      if (!typeName) errors.push({ line: lineNo, message: "entity_type requerido" });

      const tracksUsageProvided = tracksUsageIdx >= 0 && tracksRaw.length > 0;
      const parsedTracks = tracksUsageProvided ? parseBool(tracksRaw) : null;
      if (tracksUsageProvided && parsedTracks === null) {
        errors.push({ line: lineNo, message: `tracks_usage inválido: ${tracksRaw}` });
      }
      const tracksUsage = parsedTracks;

      const type = typeByName.get(typeName.toLowerCase());
      if (!type) {
        errors.push({ line: lineNo, message: `entity_type no existe en la organización: ${typeName}` });
      } else if (selectedType && type.id !== selectedType.id) {
        errors.push({ line: lineNo, message: `Solo se permite tipo ${selectedType.name} en esta carga` });
      }

      if (importMode === "update") {
        if (!entityId) {
          errors.push({ line: lineNo, message: "entity_id requerido para actualización masiva" });
        } else if (!isUuid(entityId)) {
          errors.push({ line: lineNo, message: `entity_id inválido: ${entityId}` });
        } else if (!entityTypeById.has(entityId)) {
          errors.push({ line: lineNo, message: `entity_id no existe en la organización: ${entityId}` });
        } else if (type && entityTypeById.get(entityId) !== type.id) {
          errors.push({ line: lineNo, message: "No se permite cambiar entity_type de una entidad existente por importación" });
        }
      } else if (entityId) {
        errors.push({ line: lineNo, message: "No usar entity_id en modo altas" });
      }

      const usageUnitProvided = usageUnitIdRaw.length > 0 || usageUnitNameRaw.length > 0;
      let resolvedUsageUnitId: string | null = null;
      if (tracksUsage === true || (!tracksUsageProvided && usageUnitProvided)) {
        if (usageUnitIdRaw) {
          if (!isUuid(usageUnitIdRaw)) {
            errors.push({ line: lineNo, message: `usage_unit_id inválido: ${usageUnitIdRaw}` });
          } else {
            const unit = usageUnitById.get(usageUnitIdRaw);
            if (!unit) {
              errors.push({ line: lineNo, message: `usage_unit_id no existe o está inactivo: ${usageUnitIdRaw}` });
            } else {
              resolvedUsageUnitId = unit.id;
            }
          }
        } else if (usageUnitNameRaw) {
          const unit = usageUnitByName.get(usageUnitNameRaw.toLowerCase());
          if (!unit) {
            errors.push({ line: lineNo, message: `usage_unit no existe o está inactivo: ${usageUnitNameRaw}` });
          } else {
            resolvedUsageUnitId = unit.id;
          }
        }
      }

      const fieldMap: Record<string, string> = {};
      if (type) {
        for (const col of fieldColumns) {
          const value = String(row[col.index] ?? "");
          if (!value.trim()) continue;
          const field = fieldByTypeAndKey.get(`${type.id}::${col.key}`);
          if (!field) {
            errors.push({ line: lineNo, message: `Columna field:${col.key} no existe para tipo ${type.name}` });
            continue;
          }
          fieldMap[col.key] = value;
        }
      }

      parsed.push({
        line: lineNo,
        entityId: entityId || null,
        name,
        entityTypeName: typeName,
        tracksUsage,
        tracksUsageProvided,
        usageUnitId: resolvedUsageUnitId,
        usageUnitProvided,
        fields: fieldMap,
      });
    }

    if (errors.length > 0) {
      return NextResponse.json(
        {
          ok: false,
          mode: apply ? "apply" : "validate",
          summary: { total_rows: parsed.length, errors: errors.length },
          errors,
        },
        { status: 400 }
      );
    }

    if (!apply) {
      return NextResponse.json({
        ok: true,
        mode: "validate",
        summary: {
          total_rows: parsed.length,
          to_update: importMode === "update" ? parsed.length : 0,
          to_create: importMode === "create" ? parsed.length : 0,
          errors: 0,
        },
      });
    }

    let created = 0;
    let updated = 0;
    const applyErrors: Array<{ line: number; message: string }> = [];

    for (const row of parsed) {
      const type = typeByName.get(row.entityTypeName.toLowerCase());
      if (!type) {
        applyErrors.push({ line: row.line, message: `entity_type no encontrado: ${row.entityTypeName}` });
        continue;
      }

      try {
        let entityId: string | null = row.entityId;
        if (importMode === "update") {
          if (!entityId) {
            applyErrors.push({ line: row.line, message: "entity_id requerido para actualización masiva" });
            continue;
          }
          const patch: Record<string, unknown> = { name: row.name };
          if (row.tracksUsageProvided) {
            patch.tracks_usage = row.tracksUsage === true;
            if (row.tracksUsage === false) {
              patch.usage_unit_id = null;
            } else if (row.usageUnitProvided) {
              patch.usage_unit_id = row.usageUnitId;
            }
          } else if (row.usageUnitProvided) {
            patch.usage_unit_id = row.usageUnitId;
          }

          const { error: updErr } = await db
            .from("entities")
            .update(patch)
            .eq("organization_id", orgId)
            .eq("id", entityId);
          if (updErr) throw updErr;
          updated++;
        } else {
          if (!type) {
            applyErrors.push({ line: row.line, message: `entity_type no encontrado: ${row.entityTypeName}` });
            continue;
          }
          const createTracksUsage = row.tracksUsage === true;
          const { data: ins, error: insErr } = await db
            .from("entities")
            .insert({
              organization_id: orgId,
              name: row.name,
              entity_type_id: type.id,
              tracks_usage: createTracksUsage,
              usage_unit_id: createTracksUsage ? row.usageUnitId : null,
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          entityId = String(ins.id);
          created++;
        }

        const fieldRows: Array<{ organization_id: string; entity_id: string; entity_field_id: string; value_text: string }> = [];
        for (const [key, value] of Object.entries(row.fields)) {
          const field = fieldByTypeAndKey.get(`${type.id}::${key}`);
          if (!field) continue;
          fieldRows.push({
            organization_id: orgId,
            entity_id: String(entityId),
            entity_field_id: field.id,
            value_text: value,
          });
        }
        if (fieldRows.length > 0) {
          const { error: upsertErr } = await db
            .from("entity_field_values")
            .upsert(fieldRows, { onConflict: "entity_id,entity_field_id" });
          if (upsertErr) throw upsertErr;
        }
      } catch (e: unknown) {
        if (isDuplicateEntityNameError(e)) {
          applyErrors.push({ line: row.line, message: buildDuplicateEntityNameMessage(row.name) });
          continue;
        }
        applyErrors.push({ line: row.line, message: getErrorMessage(e) });
      }
    }

    return NextResponse.json({
      ok: applyErrors.length === 0,
      mode: "apply",
      summary: {
        total_rows: parsed.length,
        created,
        updated,
        errors: applyErrors.length,
      },
      errors: applyErrors,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
