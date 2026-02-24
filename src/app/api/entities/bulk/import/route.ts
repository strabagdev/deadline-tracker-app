import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess } from "@/lib/server/orgAccess";
import { parseCsv } from "@/lib/csv/simpleCsv";

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
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const orgId = access.organizationId;

    const body = await req.json().catch(() => ({}));
    const csv = String(body?.csv ?? "");
    const apply = Boolean(body?.apply ?? false);
    const selectedEntityTypeId = String(body?.entity_type_id ?? "").trim();

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

    const headers = matrix[0].map((h) => String(h ?? "").trim());
    const indexByHeader = new Map<string, number>();
    headers.forEach((h, i) => indexByHeader.set(h, i));

    const required = ["entity_name"];
    for (const reqHeader of required) {
      if (!indexByHeader.has(reqHeader)) {
        return NextResponse.json({ error: `Falta columna requerida: ${reqHeader}`, code: "INVALID_HEADER" }, { status: 400 });
      }
    }

    const entityIdIdx = indexByHeader.get("entity_id") ?? -1;
    const nameIdx = indexByHeader.get("entity_name") ?? -1;
    const typeIdx = indexByHeader.get("entity_type") ?? -1;
    const tracksUsageIdx = indexByHeader.get("tracks_usage") ?? -1;
    const usageUnitNameIdx = indexByHeader.get("usage_unit") ?? -1;
    const usageUnitIdIdx = indexByHeader.get("usage_unit_id") ?? -1;

    const fieldColumns = headers
      .map((h, i) => ({ h, i }))
      .filter(({ h }) => h.startsWith("field:"))
      .map(({ h, i }) => ({ key: h.slice("field:".length).trim(), index: i }))
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

    for (let r = 1; r < matrix.length; r++) {
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

      if (entityId) {
        if (!isUuid(entityId)) {
          errors.push({ line: lineNo, message: `entity_id inválido: ${entityId}` });
        } else if (!entityTypeById.has(entityId)) {
          errors.push({ line: lineNo, message: `entity_id no existe en la organización: ${entityId}` });
        } else if (type && entityTypeById.get(entityId) !== type.id) {
          errors.push({ line: lineNo, message: "No se permite cambiar entity_type de una entidad existente por importación" });
        }
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
          to_create: parsed.filter((p) => !p.entityId).length,
          to_update: parsed.filter((p) => Boolean(p.entityId)).length,
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
        let entityId = row.entityId;
        if (entityId) {
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
          entityId = ins.id as string;
          created++;
        }

        const fieldRows: Array<{ organization_id: string; entity_id: string; entity_field_id: string; value_text: string }> = [];
        for (const [key, value] of Object.entries(row.fields)) {
          const field = fieldByTypeAndKey.get(`${type.id}::${key}`);
          if (!field) continue;
          fieldRows.push({
            organization_id: orgId,
            entity_id: entityId as string,
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
