import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import { createAuthAdminClient } from "@/lib/server/authAdmin";
import { getPublicAppOrigin } from "@/lib/server/publicAppOrigin";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "error";
}

export async function POST(req: Request) {
  try {
    const { user: requester } = await requireAuthUser(req);
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
    if (access.role !== "owner") {
      return NextResponse.json({ error: "owner only", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email required", code: "BAD_REQUEST" }, { status: 400 });
    }

    const authAdmin = createAuthAdminClient();
    const redirectTo = `${getPublicAppOrigin(req)}/auth/callback`;
    const { data, error } = await authAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { needs_temp_password: true, invite_test_only: true },
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          email,
          redirect_to: redirectTo,
          error: error.message,
          code: "SUPABASE_INVITE_FAILED",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      email,
      redirect_to: redirectTo,
      invited_user_id: data.user?.id ?? null,
      delivery: "email_sent",
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
