import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getSuperAdminStatus } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const status = await getSuperAdminStatus(db, user.id);

    return NextResponse.json({
      has_super_admin: status.hasSuperAdmin,
      is_super_admin: status.isCurrentSuperAdmin,
      primary_super_admin_user_id: status.primarySuperAdminUserId,
      primary_super_admin_email: status.primarySuperAdminEmail,
      user_id: user.id,
      email: user.email ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
