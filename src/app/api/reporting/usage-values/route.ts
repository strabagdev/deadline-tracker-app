import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";

type UsageFieldValueJoin = {
  usage_field_id: string;
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_boolean: boolean | null;
  usage_fields?:
    | { name: string | null; key: string | null; field_type: string | null }
    | { name: string | null; key: string | null; field_type: string | null }[]
    | null;
};

type UsageLogJoin = {
  id: string;
  entity_id: string;
  value: number | null;
  value_text: string | null;
  logged_on: string;
  logged_at: string;
  entities?:
    | {
        id: string;
        name: string;
        entity_type_id: string | null;
        usage_unit_id: string | null;
        entity_types?: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
        usage_units?: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
      }
    | {
        id: string;
        name: string;
        entity_type_id: string | null;
        usage_unit_id: string | null;
        entity_types?: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
        usage_units?: { id: string; name: string | null } | { id: string; name: string | null }[] | null;
      }[]
    | null;
  usage_log_field_values?: UsageFieldValueJoin[] | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function renderFieldValue(v: UsageFieldValueJoin) {
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
    const url = new URL(req.url);
    const entityTypeId = String(url.searchParams.get("entity_type_id") ?? "all").trim();
    const dateFrom = String(url.searchParams.get("date_from") ?? "").trim();
    const dateTo = String(url.searchParams.get("date_to") ?? "").trim();
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 1000), 1), 5000);

    let query = db
      .from("usage_logs")
      .select(
        `
        id,
        entity_id,
        value,
        value_text,
        logged_on,
        logged_at,
        entities(
          id,
          name,
          entity_type_id,
          usage_unit_id,
          entity_types(id, name),
          usage_units(id, name)
        ),
        usage_log_field_values(
          usage_field_id,
          value_text,
          value_number,
          value_date,
          value_boolean,
          usage_fields(name, key, field_type)
        )
      `
      )
      .eq("organization_id", orgId)
      .order("logged_on", { ascending: false })
      .order("logged_at", { ascending: false })
      .limit(limit);

    if (dateFrom) query = query.gte("logged_on", dateFrom);
    if (dateTo) query = query.lte("logged_on", dateTo);
    if (entityTypeId && entityTypeId !== "all") query = query.eq("entities.entity_type_id", entityTypeId);

    const { data, error } = await query;
    if (error) throw error;

    const rowsRaw = (data ?? []) as UsageLogJoin[];
    const rows = rowsRaw.map((r) => {
      const entity = pickOne(r.entities);
      const entityType = pickOne(entity?.entity_types ?? null);
      const unit = pickOne(entity?.usage_units ?? null);
      const mainValueText = String(r.value_text ?? "").trim();
      const mainValueNumber = r.value != null && Number.isFinite(Number(r.value)) ? Number(r.value) : null;
      const mainValue = mainValueText || (mainValueNumber != null ? String(mainValueNumber) : "—");
      const fieldValues = (r.usage_log_field_values ?? []).map((fv) => {
        const f = pickOne(fv.usage_fields);
        return {
          usage_field_id: String(fv.usage_field_id),
          name: String(f?.name ?? f?.key ?? "Campo"),
          value: renderFieldValue(fv),
        };
      });
      return {
        id: String(r.id),
        entity_id: String(r.entity_id),
        entity_name: String(entity?.name ?? "Entidad"),
        entity_type_id: entity?.entity_type_id ? String(entity.entity_type_id) : null,
        entity_type_name: String(entityType?.name ?? "Sin tipo"),
        usage_unit_name: String(unit?.name ?? ""),
        logged_on: String(r.logged_on),
        logged_at: String(r.logged_at),
        value: mainValueNumber,
        value_text: mainValueText || null,
        value_display: mainValue,
        field_values: fieldValues,
      };
    });

    const entityTypeOptions = Array.from(
      new Map(
        rows
          .filter((r) => r.entity_type_id)
          .map((r) => [String(r.entity_type_id), String(r.entity_type_name || "Sin tipo")])
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
      rows,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
