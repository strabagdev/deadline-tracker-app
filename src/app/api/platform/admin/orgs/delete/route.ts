import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const organizationId = String(body.organizationId ?? "").trim();
    if (!organizationId) return NextResponse.json({ error: "organizationId required" }, { status: 400 });

    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("id,name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!org?.id) return NextResponse.json({ error: "organization not found" }, { status: 404 });

    // Limpieza manual para evitar bloqueos por FK cuando no hay ON DELETE CASCADE.
    const { error: usageErr } = await db.from("usage_logs").delete().eq("organization_id", organizationId);
    if (usageErr) throw usageErr;

    const { error: deadlinesErr } = await db.from("deadlines").delete().eq("organization_id", organizationId);
    if (deadlinesErr) throw deadlinesErr;

    const { error: settingsErr } = await db
      .from("organization_settings")
      .delete()
      .eq("organization_id", organizationId);
    if (settingsErr) throw settingsErr;

    const { error: membersErr } = await db
      .from("organization_members")
      .delete()
      .eq("organization_id", organizationId);
    if (membersErr) throw membersErr;

    const { error: entitiesErr } = await db.from("entities").delete().eq("organization_id", organizationId);
    if (entitiesErr) throw entitiesErr;

    const { error: typeErr } = await db
      .from("deadline_types")
      .delete()
      .eq("organization_id", organizationId);
    if (typeErr) throw typeErr;

    const { error: entityTypeErr } = await db
      .from("entity_types")
      .delete()
      .eq("organization_id", organizationId);
    if (entityTypeErr) throw entityTypeErr;

    const { error: userSettingsErr } = await db
      .from("user_settings")
      .update({ active_organization_id: null, updated_at: new Date().toISOString() })
      .eq("active_organization_id", organizationId);
    if (userSettingsErr) throw userSettingsErr;

    const { error: deleteOrgErr } = await db.from("organizations").delete().eq("id", organizationId);
    if (deleteOrgErr) throw deleteOrgErr;

    return NextResponse.json({ ok: true, organization: { id: org.id, name: org.name } });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
