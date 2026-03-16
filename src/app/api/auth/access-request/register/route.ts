import { NextResponse } from "next/server";
import { createAuthAdminClient } from "@/lib/server/authAdmin";
import { createDataServerClient } from "@/lib/supabase/dataServer";

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

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = String(body.userId ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();

    if (!userId || !email) {
      return NextResponse.json({ error: "userId and email required", code: "BAD_REQUEST" }, { status: 400 });
    }

    const authAdmin = createAuthAdminClient();
    const { data: authUserData, error: authUserErr } = await authAdmin.auth.admin.getUserById(userId);
    if (authUserErr) throw authUserErr;

    const authUserEmail = String(authUserData.user?.email ?? "").trim().toLowerCase();
    if (!authUserData.user?.id || authUserEmail !== email) {
      return NextResponse.json({ error: "auth user mismatch", code: "BAD_REQUEST" }, { status: 400 });
    }

    const db = createDataServerClient();

    const { error: profileErr } = await db.from("profiles").upsert(
      {
        user_id: userId,
        email,
      },
      { onConflict: "user_id" }
    );
    if (profileErr) throw profileErr;

    const { data: memberships, error: membershipErr } = await db
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .limit(1);
    if (membershipErr) throw membershipErr;

    if (Array.isArray(memberships) && memberships.length > 0) {
      return NextResponse.json({ ok: true, created: false, reason: "already_member" });
    }

    const { data: latestRequest, error: requestErr } = await db
      .from("organization_access_requests")
      .select("id,status")
      .eq("user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (requestErr) throw requestErr;

    if (!latestRequest?.id) {
      const { error: insertReqErr } = await db.from("organization_access_requests").insert({
        user_id: userId,
        email,
        status: "pending",
      });
      if (insertReqErr) throw insertReqErr;
      return NextResponse.json({ ok: true, created: true });
    }

    return NextResponse.json({ ok: true, created: false, reason: latestRequest.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
