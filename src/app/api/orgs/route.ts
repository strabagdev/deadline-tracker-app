import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

type OrgJoinRow = {
  role: string;
  organizations?: { id?: string | null; name?: string | null } | null;
};

type AccessRequestRow = {
  id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at?: string | null;
  organization_id?: string | null;
  assigned_role?: string | null;
  note?: string | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unauthorized";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const globalOnly = await isSuperAdmin(db, user.id);
    if (globalOnly) {
      return NextResponse.json({ error: "super admin global only", code: "FORBIDDEN" }, { status: 403 });
    }

    // Obtenemos memberships y el nombre de la org (join)
    const { data, error } = await db
      .from("organization_members")
      .select("role, organizations:organizations(id,name)")
      .eq("user_id", user.id);

    if (error) throw error;

    const orgs = ((data ?? []) as OrgJoinRow[])
      .map((row) => ({
        id: row.organizations?.id,
        name: row.organizations?.name,
        role: row.role,
      }))
      .filter((o) => o.id && o.name);

    let accessRequest: AccessRequestRow | null = null;
    if (orgs.length === 0) {
      const { data: requestData, error: requestErr } = await db
        .from("organization_access_requests")
        .select("id,status,requested_at,resolved_at,organization_id,assigned_role,note")
        .eq("user_id", user.id)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (requestErr) throw requestErr;
      accessRequest = (requestData as AccessRequestRow | null) ?? null;
    }

    return NextResponse.json({ orgs, access_request: accessRequest });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) },
      { status: 401 }
    );
  }
}
