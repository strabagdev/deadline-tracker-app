import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getErrorMessage } from "@/lib/server/adminOrgAccess";

type MemberRow = {
  user_id: string;
  role: string;
  created_at: string;
};

type ProfileRow = {
  user_id: string;
  email: string | null;
};

export async function GET(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const db = createDataServerClient();

    const ctx = await getAdminOrgAccess(db, requester.id);
    if ("error" in ctx) {
      return NextResponse.json({ error: ctx.error }, { status: 403 });
    }

    const { organizationId } = ctx;

    const { data: members, error: memErr } = await db
      .from("organization_members")
      .select("user_id, role, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (memErr) throw memErr;

    const list = (members as MemberRow[] | null | undefined) ?? [];
    const userIds = list.map((m) => m.user_id);

    const profilesMap = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles, error: profErr } = await db
        .from("profiles")
        .select("user_id, email")
        .in("user_id", userIds);

      if (profErr) throw profErr;

      ((profiles as ProfileRow[] | null | undefined) ?? []).forEach((p) => {
        profilesMap.set(p.user_id, p.email ?? "");
      });
    }

    const enriched = list.map((m) => ({
      ...m,
      email: profilesMap.get(m.user_id) ?? "",
    }));

    return NextResponse.json({ organization_id: organizationId, members: enriched });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
