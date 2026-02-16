import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

type OrgJoinRow = {
  role: string;
  organizations?: { id?: string | null; name?: string | null } | null;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unauthorized";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

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

    return NextResponse.json({ orgs });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(e) },
      { status: 401 }
    );
  }
}
