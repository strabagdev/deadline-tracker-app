import { NextResponse } from "next/server";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { findAuthUserIdByEmail } from "@/lib/server/authAdmin";
import { getConfiguredSuperAdminEmail, hasAnySuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function GET() {
  try {
    const db = createDataServerClient();
    const configuredEmail = getConfiguredSuperAdminEmail();
    const hasSuperAdminInData = await hasAnySuperAdmin(db);
    const configuredAuthUserId = configuredEmail ? await findAuthUserIdByEmail(configuredEmail) : null;
    const hasSuperAdmin = configuredEmail ? hasSuperAdminInData && Boolean(configuredAuthUserId) : hasSuperAdminInData;

    return NextResponse.json({
      has_super_admin: hasSuperAdmin,
      configured_super_admin_email: configuredEmail || null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
