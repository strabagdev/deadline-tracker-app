import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";

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

    const url = new URL(req.url);
    const rawIds = String(url.searchParams.get("entity_ids") ?? "").trim();
    const entityIds = rawIds
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .slice(0, 500);

    if (entityIds.length === 0) {
      return NextResponse.json({ by_entity: {} });
    }

    const { data, error } = await db
      .from("usage_logs")
      .select("entity_id, logged_on")
      .eq("organization_id", access.organizationId)
      .in("entity_id", entityIds)
      .order("logged_on", { ascending: false });
    if (error) throw error;

    const byEntity: Record<string, string[]> = {};
    for (const row of data ?? []) {
      const entityId = String(row.entity_id);
      const day = String(row.logged_on ?? "").trim();
      if (!day) continue;
      if (!byEntity[entityId]) byEntity[entityId] = [];
      if (!byEntity[entityId].includes(day)) byEntity[entityId].push(day);
    }

    return NextResponse.json({ by_entity: byEntity });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
