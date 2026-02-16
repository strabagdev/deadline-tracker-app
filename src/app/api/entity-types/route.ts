import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getOrgAccess } from "@/lib/server/orgAccess";

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
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }

    const { data, error } = await db
      .from("entity_types")
      .select("id, name, icon, created_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return NextResponse.json({ entity_types: data ?? [] });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      const status = access.error === "no active organization" ? 400 : 403;
      const error = access.error === "forbidden" ? "admin required" : access.error;
      return NextResponse.json({ error }, { status });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const icon = body?.icon ? String(body.icon).trim() : null;

    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const { data, error } = await db
      .from("entity_types")
      .insert({ organization_id: access.organizationId, name, icon })
      .select("id, name, icon, created_at")
      .single();

    if (error) throw error;
    return NextResponse.json({ entity_type: data }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
