import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

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

    const orgs = (data ?? [])
      .map((row: any) => ({
        id: row.organizations?.id,
        name: row.organizations?.name,
        role: row.role,
      }))
      .filter((o: any) => o.id && o.name);

    return NextResponse.json({ orgs });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unauthorized" },
      { status: 401 }
    );
  }
}
