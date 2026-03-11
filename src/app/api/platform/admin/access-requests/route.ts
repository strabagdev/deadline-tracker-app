import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

type AccessRequestRow = {
  id: string;
  user_id: string;
  email: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at?: string | null;
  organization_id?: string | null;
  assigned_role?: string | null;
  note?: string | null;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });

    const { data, error } = await db
      .from("organization_access_requests")
      .select("id,user_id,email,status,requested_at,resolved_at,organization_id,assigned_role,note")
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const requests = ((data ?? []) as AccessRequestRow[]).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      email: row.email,
      status: row.status,
      requested_at: row.requested_at,
      resolved_at: row.resolved_at ?? null,
      organization_id: row.organization_id ?? null,
      assigned_role: row.assigned_role ?? null,
      note: row.note ?? null,
    }));

    return NextResponse.json({ requests });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestId = String(body.requestId ?? "").trim();
    const action = String(body.action ?? "").trim().toLowerCase();
    const organizationId = String(body.organizationId ?? "").trim();
    const role = String(body.role ?? "member").trim().toLowerCase();
    const note = String(body.note ?? "").trim();

    if (!requestId) {
      return NextResponse.json({ error: "requestId required", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (!["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "invalid action", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (action === "approve" && !organizationId) {
      return NextResponse.json({ error: "organizationId required", code: "BAD_REQUEST" }, { status: 400 });
    }
    if (action === "approve" && !["owner", "admin", "member", "viewer"].includes(role)) {
      return NextResponse.json({ error: "invalid role", code: "BAD_REQUEST" }, { status: 400 });
    }

    const { data: requestRow, error: requestErr } = await db
      .from("organization_access_requests")
      .select("id,user_id,email,status")
      .eq("id", requestId)
      .maybeSingle();
    if (requestErr) throw requestErr;
    if (!requestRow?.id) {
      return NextResponse.json({ error: "request not found", code: "NOT_FOUND" }, { status: 404 });
    }
    if (String(requestRow.status) !== "pending") {
      return NextResponse.json({ error: "request already resolved", code: "BAD_REQUEST" }, { status: 400 });
    }

    if (action === "approve") {
      const { data: orgRow, error: orgErr } = await db
        .from("organizations")
        .select("id,name")
        .eq("id", organizationId)
        .maybeSingle();
      if (orgErr) throw orgErr;
      if (!orgRow?.id) {
        return NextResponse.json({ error: "organization not found", code: "NOT_FOUND" }, { status: 404 });
      }

      const { error: profileErr } = await db.from("profiles").upsert(
        {
          user_id: String(requestRow.user_id),
          email: String(requestRow.email).trim().toLowerCase(),
        },
        { onConflict: "user_id" }
      );
      if (profileErr) throw profileErr;

      const { error: memberErr } = await db.from("organization_members").upsert(
        {
          organization_id: orgRow.id,
          user_id: requestRow.user_id,
          role,
        },
        { onConflict: "organization_id,user_id" }
      );
      if (memberErr) throw memberErr;

      const { error: settingsErr } = await db.from("user_settings").upsert(
        {
          user_id: requestRow.user_id,
          active_organization_id: orgRow.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (settingsErr) throw settingsErr;

      const { error: updateErr } = await db
        .from("organization_access_requests")
        .update({
          status: "approved",
          resolved_at: new Date().toISOString(),
          resolved_by: user.id,
          organization_id: orgRow.id,
          assigned_role: role,
          note: note || null,
        })
        .eq("id", requestId);
      if (updateErr) throw updateErr;

      return NextResponse.json({
        ok: true,
        request: {
          id: requestId,
          status: "approved",
          organization_id: orgRow.id,
          assigned_role: role,
        },
      });
    }

    const { error: rejectErr } = await db
      .from("organization_access_requests")
      .update({
        status: "rejected",
        resolved_at: new Date().toISOString(),
        resolved_by: user.id,
        note: note || null,
      })
      .eq("id", requestId);
    if (rejectErr) throw rejectErr;

    return NextResponse.json({
      ok: true,
      request: {
        id: requestId,
        status: "rejected",
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
