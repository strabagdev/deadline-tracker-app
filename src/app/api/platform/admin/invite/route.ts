import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";
import { createAuthAdminClient, findAuthUserIdByEmail } from "@/lib/server/authAdmin";
import { parsePlatformInvitePayload } from "@/lib/api/platformAdminInput";
import { getPublicAppOrigin } from "@/lib/server/publicAppOrigin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

const VALID_ROLES = ["owner", "admin", "member", "viewer"] as const;

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only", code: "FORBIDDEN" }, { status: 403 });

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parsePlatformInvitePayload(body, VALID_ROLES);
    if (!parsed.ok) return NextResponse.json(parsed.body, { status: parsed.status });
    const { organizationId, email, role } = parsed;

    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("id,name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgErr) throw orgErr;
    if (!org?.id) return NextResponse.json({ error: "organization not found", code: "ORGANIZATION_NOT_FOUND" }, { status: 404 });

    const authAdmin = createAuthAdminClient();

    const redirectTo = `${getPublicAppOrigin(req)}/auth/callback`;
    const { data: inviteData, error: inviteErr } = await authAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { needs_temp_password: true },
    });

    let invitedUserId = inviteData.user?.id ?? null;
    if (inviteErr) {
      if (inviteErr.message.toLowerCase().includes("already")) {
        // Usuario ya existe en Auth, resolvemos user_id directo desde Auth.
        invitedUserId = await findAuthUserIdByEmail(email);
      } else {
        return NextResponse.json({ error: inviteErr.message, code: "BAD_REQUEST" }, { status: 400 });
      }
    }

    if (!invitedUserId) {
      invitedUserId = await findAuthUserIdByEmail(email);
    }

    if (!invitedUserId) {
      return NextResponse.json(
        {
          error: "No se pudo resolver el usuario invitado. Pídele iniciar sesión una vez e intenta de nuevo.",
          code: "INVITED_USER_NOT_RESOLVED",
        },
        { status: 400 }
      );
    }

    const { error: profileErr } = await db.from("profiles").upsert(
      {
        user_id: invitedUserId,
        email,
      },
      { onConflict: "user_id" }
    );
    if (profileErr) throw profileErr;

    const { error: memberErr } = await db.from("organization_members").upsert(
      {
        organization_id: organizationId,
        user_id: invitedUserId,
        role,
      },
      { onConflict: "organization_id,user_id" }
    );
    if (memberErr) throw memberErr;

    return NextResponse.json({
      ok: true,
      organization: { id: org.id, name: org.name },
      invited: { user_id: invitedUserId, email, role },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
