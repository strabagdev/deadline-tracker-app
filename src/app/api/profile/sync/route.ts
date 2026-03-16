import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

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
    const { user } = await requireAuthUser(req);

    const email = (user.email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "No email on auth user", code: "BAD_REQUEST" }, { status: 400 });
    }

    const db = createDataServerClient();

    const { error } = await db.from("profiles").upsert({
      user_id: user.id,
      email,
    });

    if (error) throw error;

    const superAdmin = await isSuperAdmin(db, user.id);
    if (!superAdmin) {
      const { data: memberships, error: membershipErr } = await db
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1);
      if (membershipErr) throw membershipErr;

      if (!Array.isArray(memberships) || memberships.length === 0) {
        const { data: latestRequest, error: requestErr } = await db
          .from("organization_access_requests")
          .select("id,status")
          .eq("user_id", user.id)
          .order("requested_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (requestErr) throw requestErr;

        if (!latestRequest?.id) {
          const { error: insertReqErr } = await db.from("organization_access_requests").insert({
            user_id: user.id,
            email,
            status: "pending",
          });
          if (insertReqErr) throw insertReqErr;
        }
      }
    }

    return NextResponse.json({ ok: true, user_id: user.id, email });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
