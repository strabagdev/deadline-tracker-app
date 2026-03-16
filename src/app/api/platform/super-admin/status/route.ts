import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getSuperAdminStatus } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as {
      message?: unknown;
      error?: unknown;
      error_description?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    const parts = [
      maybe.message,
      maybe.error,
      maybe.error_description,
      maybe.details,
      maybe.hint,
    ]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0);
    if (parts.length > 0) return parts.join(" | ");
  }
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
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
