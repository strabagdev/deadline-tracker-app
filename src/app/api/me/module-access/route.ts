import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { defaultModulesByRole } from "@/lib/access/moduleKeys";
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

    if (!access.memberTypeId) {
      return NextResponse.json({
        organization_id: access.organizationId,
        role: access.role,
        member_type_id: null,
        allowed_modules: defaultModulesByRole(access.role),
      });
    }

    const { data, error } = await db
      .from("organization_member_type_modules")
      .select("module_key, can_view")
      .eq("organization_id", access.organizationId)
      .eq("member_type_id", access.memberTypeId);
    if (error) throw error;

    const allowedModules = (data ?? [])
      .filter((r) => Boolean(r.can_view))
      .map((r) => String(r.module_key))
      .filter((v, i, arr) => arr.indexOf(v) === i);

    return NextResponse.json({
      organization_id: access.organizationId,
      role: access.role,
      member_type_id: access.memberTypeId,
      allowed_modules: allowedModules.length > 0 ? allowedModules : defaultModulesByRole(access.role),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
