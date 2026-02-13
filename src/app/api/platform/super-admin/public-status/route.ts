import { NextResponse } from "next/server";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { hasAnySuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function GET() {
  try {
    const db = createDataServerClient();
    const hasSuperAdmin = await hasAnySuperAdmin(db);
    return NextResponse.json({ has_super_admin: hasSuperAdmin });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
