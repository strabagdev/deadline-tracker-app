import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";
import { parseOrganizationIdPayload } from "@/lib/api/platformAdminInput";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

async function deleteByOrganizationId(
  db: ReturnType<typeof createDataServerClient>,
  table: string,
  organizationId: string
) {
  const { error } = await db.from(table).delete().eq("organization_id", organizationId);
  if (error) throw error;
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseOrganizationIdPayload(body);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    const { organizationId } = parsed;

    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("id,name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!org?.id) return NextResponse.json({ error: "organization not found", code: "ORGANIZATION_NOT_FOUND" }, { status: 404 });

    const { error: userSettingsErr } = await db
      .from("user_settings")
      .update({ active_organization_id: null, updated_at: new Date().toISOString() })
      .eq("active_organization_id", organizationId);
    if (userSettingsErr) throw userSettingsErr;

    // Limpieza explícita alineada al modelo bootstrap actual para tolerar bases legacy con cascadas incompletas.
    for (const table of [
      "organization_member_type_modules",
      "organization_invite_email_cooldowns",
      "reporting_endpoints",
      "deadline_change_events",
      "alert_events",
      "deadline_forecasts",
      "usage_log_field_values",
      "usage_logs",
      "usage_fields",
      "usage_units",
      "entity_field_values",
      "entity_fields",
      "deadlines",
      "deadline_types",
      "entities",
      "entity_types",
      "organization_access_requests",
      "organization_members",
      "organization_member_types",
      "organization_settings",
    ] as const) {
      await deleteByOrganizationId(db, table, organizationId);
    }

    const { error: deleteOrgErr } = await db.from("organizations").delete().eq("id", organizationId);
    if (deleteOrgErr) throw deleteOrgErr;

    return NextResponse.json({ ok: true, organization: { id: org.id, name: org.name } });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
