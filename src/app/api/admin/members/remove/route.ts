import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";

export async function POST(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
    const body = await req.json().catch(() => ({}));
    const userId = (body.userId as string | undefined)?.trim();

    if (!userId) return NextResponse.json({ error: "userId required", code: "BAD_REQUEST" }, { status: 400 });

    const db = createDataServerClient();
    const access = await getOrgAccess(db, requester.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canUsers = await canViewModule(db, access.organizationId, access.role, access.memberTypeId, "users");
    if (!canUsers || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }
    const organizationId = access.organizationId;

    if (userId === requester.id) {
      return NextResponse.json({ error: "No puedes quitarte tu propio acceso.", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data: target, error: tErr } = await db
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (tErr) throw tErr;
    if (!target) return NextResponse.json({ error: "Usuario no es miembro de esta org.", code: "MEMBER_NOT_FOUND" }, { status: 404 });

    if (target.role === "owner") {
      return NextResponse.json({ error: "No se puede remover al owner.", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { error: delErr } = await db
      .from("organization_members")
      .delete()
      .eq("organization_id", organizationId)
      .eq("user_id", userId);

    if (delErr) throw delErr;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "error", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}
