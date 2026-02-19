import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess } from "@/lib/server/orgAccess";
import { toCsv } from "@/lib/csv/simpleCsv";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
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

    const [{ data: types, error: typeErr }, { data: fields, error: fieldErr }, { data: entities, error: entErr }] =
      await Promise.all([
        db.from("entity_types").select("id, name").eq("organization_id", orgId),
        db.from("entity_fields").select("id, entity_type_id, key").eq("organization_id", orgId),
        db
          .from("entities")
          .select("id, name, entity_type_id, tracks_usage")
          .eq("organization_id", orgId)
          .order("created_at", { ascending: false }),
      ]);

    if (typeErr) throw typeErr;
    if (fieldErr) throw fieldErr;
    if (entErr) throw entErr;

    const typeList = (types ?? []) as Array<{ id: string; name: string }>;
    const effectiveType = selectedTypeId ? typeList.find((t) => t.id === selectedTypeId) ?? null : null;
    if (selectedTypeId && !effectiveType) {
      return NextResponse.json({ error: "entity_type_id inválido", code: "INVALID_ENTITY_TYPE" }, { status: 400 });
    }

    const filteredEntities = ((entities ?? []) as Array<{ id: string; name: string; entity_type_id: string; tracks_usage: boolean }>).filter((e) =>
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

    const entityIds = filteredEntities.map((e) => e.id);

    const valuesByEntityAndField = new Map<string, string>();
    if (entityIds.length > 0) {
      const { data: values, error: valErr } = await db
        .from("entity_field_values")
        .select("entity_id, entity_field_id, value_text")
        .eq("organization_id", orgId)
        .in("entity_id", entityIds);
      if (valErr) throw valErr;
      for (const v of (values ?? []) as Array<{ entity_id: string; entity_field_id: string; value_text: string | null }>) {
        valuesByEntityAndField.set(`${v.entity_id}::${v.entity_field_id}`, String(v.value_text ?? ""));
      }
    }

    const header = ["entity_id", "entity_name", "entity_type", "tracks_usage", ...fieldKeys.map((k) => `field:${k}`)];

    const rows: string[][] = [header];
    for (const e of filteredEntities) {
      const line = [e.id, e.name, typeNameById.get(e.entity_type_id) ?? "", e.tracks_usage ? "true" : "false"];
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
