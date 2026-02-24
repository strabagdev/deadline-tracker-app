import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess } from "@/lib/server/orgAccess";
import { toCsv } from "@/lib/csv/simpleCsv";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

async function fetchEntityFieldValuesAll(
  db: ReturnType<typeof createDataServerClient>,
  orgId: string,
  entityIds: string[]
) {
  const out: Array<{ entity_id: string; entity_field_id: string; value_text: string | null; updated_at: string | null }> = [];
  if (entityIds.length === 0) return out;

  // Evita payloads enormes en `in (...)`.
  const idChunkSize = 200;
  for (let i = 0; i < entityIds.length; i += idChunkSize) {
    const idChunk = entityIds.slice(i, i + idChunkSize);
    let from = 0;
    const pageSize = 1000;
    for (;;) {
      const to = from + pageSize - 1;
      const { data, error } = await db
        .from("entity_field_values")
        .select("entity_id, entity_field_id, value_text, updated_at")
        .eq("organization_id", orgId)
        .in("entity_id", idChunk)
        // Orden estable para paginación por rango.
        .order("updated_at", { ascending: false })
        .order("entity_id", { ascending: true })
        .order("entity_field_id", { ascending: true })
        .range(from, to);
      if (error) throw error;
      const rows = (data ?? []) as Array<{ entity_id: string; entity_field_id: string; value_text: string | null; updated_at: string | null }>;
      out.push(...rows);
      if (rows.length < pageSize) break;
      from += pageSize;
    }
  }

  return out;
}

export async function GET(req: Request) {
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
    const url = new URL(req.url);
    const selectedTypeId = String(url.searchParams.get("entity_type_id") ?? "").trim();

    const [
      { data: types, error: typeErr },
      { data: fields, error: fieldErr },
      { data: entities, error: entErr },
      { data: usageUnits, error: usageUnitsErr },
    ] =
      await Promise.all([
        db.from("entity_types").select("id, name").eq("organization_id", orgId),
        db.from("entity_fields").select("id, entity_type_id, key").eq("organization_id", orgId),
        db
          .from("entities")
          .select("id, name, entity_type_id, tracks_usage, usage_unit_id")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
        db.from("usage_units").select("id, name").eq("organization_id", orgId),
      ]);

    if (typeErr) throw typeErr;
    if (fieldErr) throw fieldErr;
    if (entErr) throw entErr;
    if (usageUnitsErr) throw usageUnitsErr;

    const typeList = (types ?? []) as Array<{ id: string; name: string }>;
    const effectiveType = selectedTypeId ? typeList.find((t) => t.id === selectedTypeId) ?? null : null;
    if (selectedTypeId && !effectiveType) {
      return NextResponse.json({ error: "entity_type_id inválido", code: "INVALID_ENTITY_TYPE" }, { status: 400 });
    }

    const filteredEntities = ((
      entities ?? []
    ) as Array<{ id: string; name: string; entity_type_id: string; tracks_usage: boolean; usage_unit_id: string | null }>).filter((e) =>
      effectiveType ? e.entity_type_id === effectiveType.id : true
    );
    const filteredFields = ((fields ?? []) as Array<{ id: string; entity_type_id: string; key: string | null }>).filter((f) =>
      effectiveType ? f.entity_type_id === effectiveType.id : true
    );
    const fieldKeys = Array.from(
      new Set(filteredFields.map((f) => String(f.key ?? "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const fieldByTypeAndKey = new Map<string, { id: string; key: string }>();
    for (const f of filteredFields as Array<{ id: string; entity_type_id: string; key: string }>) {
      fieldByTypeAndKey.set(`${f.entity_type_id}::${String(f.key).trim()}`, { id: f.id, key: f.key });
    }

    const typeNameById = new Map<string, string>();
    for (const t of typeList) {
      typeNameById.set(t.id, t.name);
    }
    const usageUnitNameById = new Map<string, string>();
    for (const u of (usageUnits ?? []) as Array<{ id: string; name: string }>) {
      usageUnitNameById.set(u.id, String(u.name ?? ""));
    }

    const entityIds = filteredEntities.map((e) => e.id);

    const valuesByEntityAndField = new Map<string, string>();
    if (entityIds.length > 0) {
      const values = await fetchEntityFieldValuesAll(db, orgId, entityIds);
      for (const v of values) {
        const mapKey = `${v.entity_id}::${v.entity_field_id}`;
        const incoming = String(v.value_text ?? "");
        if (!valuesByEntityAndField.has(mapKey)) {
          valuesByEntityAndField.set(mapKey, incoming);
          continue;
        }
        const existing = valuesByEntityAndField.get(mapKey) ?? "";
        // Si ya hay valor y llega vacío, no pisar.
        if (!incoming.trim() && existing.trim()) continue;
        // Si hay vacío y llega valor, reemplazar.
        if (incoming.trim() && !existing.trim()) {
          valuesByEntityAndField.set(mapKey, incoming);
        }
      }
    }

    const header = [
      "entity_id",
      "entity_name",
      "entity_type",
      "tracks_usage",
      "usage_unit",
      "usage_unit_id",
      ...fieldKeys.map((k) => `field:${k}`),
    ];

    const rows: string[][] = [header];
    for (const e of filteredEntities) {
      const usageUnitId = String(e.usage_unit_id ?? "");
      const usageUnitName = usageUnitId ? usageUnitNameById.get(usageUnitId) ?? "" : "";
      const line = [
        e.id,
        e.name,
        typeNameById.get(e.entity_type_id) ?? "",
        e.tracks_usage ? "true" : "false",
        usageUnitName,
        usageUnitId,
      ];
      for (const key of fieldKeys) {
        const field = fieldByTypeAndKey.get(`${e.entity_type_id}::${key}`);
        if (!field) {
          line.push("");
          continue;
        }
        line.push(valuesByEntityAndField.get(`${e.id}::${field.id}`) ?? "");
      }
      rows.push(line);
    }

    const csv = toCsv(rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="entities_export.csv"',
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
