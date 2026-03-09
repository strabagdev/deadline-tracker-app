import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import { toCsv } from "@/lib/csv/simpleCsv";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
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
    const canEntities = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "entities");
    if (!canEntities || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const orgId = access.organizationId;
    const url = new URL(req.url);
    const selectedTypeId = String(url.searchParams.get("entity_type_id") ?? "").trim();
    const modeRaw = String(url.searchParams.get("mode") ?? "update").trim().toLowerCase();
    const mode = modeRaw === "create" ? "create" : "update";

    const [{ data: types, error: typeErr }, { data: fields, error: fieldErr }] = await Promise.all([
      db.from("entity_types").select("id, name").eq("organization_id", orgId).order("name"),
      db.from("entity_fields").select("entity_type_id, key").eq("organization_id", orgId).order("created_at"),
    ]);

    if (typeErr) throw typeErr;
    if (fieldErr) throw fieldErr;

    const typeList = (types ?? []) as Array<{ id: string; name: string }>;
    const effectiveType = selectedTypeId ? typeList.find((t) => t.id === selectedTypeId) ?? null : null;
    if (selectedTypeId && !effectiveType) {
      return NextResponse.json({ error: "entity_type_id inválido", code: "INVALID_ENTITY_TYPE" }, { status: 400 });
    }

    const filteredFields = ((fields ?? []) as Array<{ entity_type_id: string; key: string | null }>).filter((f) =>
      effectiveType ? f.entity_type_id === effectiveType.id : true
    );

    const fieldKeys = Array.from(
      new Set(filteredFields.map((f) => String(f.key ?? "").trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const header = [
      ...(mode === "update" ? ["entity_id"] : []),
      "entity_name",
      "entity_type",
      "tracks_usage",
      "usage_unit",
      "usage_unit_id",
      ...fieldKeys.map((k) => `field:${k}`),
    ];

    const csv = toCsv([header]);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="entities_template.csv"',
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
