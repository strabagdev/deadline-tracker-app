import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import { createAuthAdminClient, findAuthUserIdByEmail } from "@/lib/server/authAdmin";
import { getPublicAppUrl } from "@/lib/server/publicAppOrigin";
import { AuthEmailProviderError, ensureSupabaseRedirect, isResendConfigured, sendAuthEmail } from "@/lib/server/authEmail";
import type { GenerateLinkResponse } from "@supabase/auth-js";

type MemberListRow = {
  user_id: string;
  role: string;
  member_type_id?: string | null;
  created_at: string;
  profiles?: { email?: string | null } | { email?: string | null }[] | null;
  organization_member_types?: { name?: string | null } | { name?: string | null }[] | null;
};

type InviteCooldownRow = {
  cooldown_until: string;
  last_error?: string | null;
};

const INVITE_EMAIL_COOLDOWN_MS = 75_000;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function isInviteRateLimitError(raw: string) {
  const lower = raw.toLowerCase();
  return lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429");
}

function getRetrySecondsFromMessage(raw: string): number | null {
  const lower = raw.toLowerCase();
  const match = lower.match(/(\d+)\s*seconds?/);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function buildCooldownResponse(email: string, cooldownUntilIso: string, reason?: string | null) {
  const retryMs = new Date(cooldownUntilIso).getTime() - Date.now();
  const retrySeconds = Math.max(1, Math.ceil(retryMs / 1000));
  return NextResponse.json(
    {
      error: `Espera ${retrySeconds}s antes de reenviar la invitación a ${email}.`,
      code: "INVITE_EMAIL_COOLDOWN",
      email,
      cooldown_until: cooldownUntilIso,
      retry_seconds: retrySeconds,
      provider_error: reason ?? null,
    },
    { status: 429 }
  );
}

/*
  Este endpoint:
  - GET  → lista miembros de la org activa
  - POST → invita usuario a la org activa
*/

/* ===========================
   GET - Listar miembros
=========================== */
export async function GET(req: Request) {
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

    const organizationId = access.organizationId;

    const { data: rows, error: listErr } = await db
      .from("organization_members")
      .select("user_id, role, member_type_id, created_at, profiles:profiles(email), organization_member_types(name)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: true });

    if (listErr) throw listErr;

    const safeRows: MemberListRow[] = Array.isArray(rows) ? (rows as MemberListRow[]) : [];
    const members = safeRows.map((r) => ({
      user_id: r.user_id,
      role: r.role,
      member_type_id: r.member_type_id ?? null,
      member_type_name: Array.isArray(r.organization_member_types)
        ? r.organization_member_types[0]?.name ?? null
        : r.organization_member_types?.name ?? null,
      created_at: r.created_at,
      email: Array.isArray(r.profiles) ? r.profiles[0]?.email ?? "" : r.profiles?.email ?? "",
    }));

    return NextResponse.json({ organization_id: organizationId, members });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

/* ===========================
   POST - Invitar usuario
=========================== */
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

    const organizationId = access.organizationId;
    const { data: org, error: orgErr } = await db
      .from("organizations")
      .select("id,name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgErr) throw orgErr;

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "member");
    const memberTypeId = body.member_type_id ? String(body.member_type_id).trim() : "";

    if (!email) {
      return NextResponse.json({ error: "email required", code: "BAD_REQUEST" }, { status: 400 });
    }

    if (!["member", "admin", "viewer", "owner"].includes(role)) {
      return NextResponse.json({ error: "invalid role", code: "BAD_REQUEST" }, { status: 400 });
    }

    const existingAuthUserId = await findAuthUserIdByEmail(email);

    let effectiveRole = role;
    let effectiveMemberTypeId: string | null = memberTypeId || null;
    if (memberTypeId) {
      const { data: mt, error: mtErr } = await db
        .from("organization_member_types")
        .select("id, name, is_active")
        .eq("organization_id", organizationId)
        .eq("id", memberTypeId)
        .maybeSingle();
      if (mtErr) throw mtErr;
      if (!mt || !mt.is_active) {
        return NextResponse.json({ error: "invalid member_type_id", code: "BAD_REQUEST" }, { status: 400 });
      }
      const name = String(mt.name ?? "").trim().toLowerCase();
      if (["owner", "admin", "member", "viewer"].includes(name)) {
        effectiveRole = name;
      } else {
        effectiveRole = "member";
      }
      effectiveMemberTypeId = String(mt.id);
    }

    let invitedUserId = existingAuthUserId;
    const inviteDelivery: "email_sent" | "existing_user_linked" = existingAuthUserId ? "existing_user_linked" : "email_sent";

    if (!existingAuthUserId) {
      const { data: cooldownRow, error: cooldownReadErr } = await db
        .from("organization_invite_email_cooldowns")
        .select("cooldown_until, last_error")
        .eq("organization_id", organizationId)
        .eq("email", email)
        .maybeSingle<InviteCooldownRow>();
      if (cooldownReadErr) throw cooldownReadErr;

      if (cooldownRow) {
        const cooldownUntilTs = new Date(cooldownRow.cooldown_until).getTime();
        if (Number.isFinite(cooldownUntilTs) && cooldownUntilTs > Date.now()) {
          return buildCooldownResponse(email, cooldownRow.cooldown_until, cooldownRow.last_error);
        }
      }

      const supabaseAuthAdmin = createAuthAdminClient();

      const redirectTo = getPublicAppUrl(req, "/auth/callback");
      const shouldUseResend = isResendConfigured();
      let inviteData: { user: { id?: string | null } | null; properties?: GenerateLinkResponse["data"]["properties"] | null } = { user: null };
      let inviteErr: { message: string } | null = null;

      if (shouldUseResend) {
        const result = await supabaseAuthAdmin.auth.admin.generateLink({
          type: "invite",
          email,
          options: {
            redirectTo,
            data: { needs_temp_password: true },
          },
        });
        inviteData = {
          user: result.data.user,
          properties: result.data.properties,
        };
        inviteErr = result.error;
      } else {
        const result = await supabaseAuthAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo,
          data: { needs_temp_password: true },
        });
        inviteData = { user: result.data.user };
        inviteErr = result.error;
      }

      if (inviteErr) {
        if (isInviteRateLimitError(inviteErr.message)) {
          const retrySeconds = getRetrySecondsFromMessage(inviteErr.message);
          const cooldownUntil = new Date(Date.now() + (retrySeconds ? retrySeconds * 1000 + 2_000 : INVITE_EMAIL_COOLDOWN_MS)).toISOString();
          const { error: cooldownWriteErr } = await db.from("organization_invite_email_cooldowns").upsert(
            {
              organization_id: organizationId,
              email,
              cooldown_until: cooldownUntil,
              last_error: inviteErr.message,
              last_requested_by: requester.id,
            },
            { onConflict: "organization_id,email" }
          );
          if (cooldownWriteErr) throw cooldownWriteErr;
          return buildCooldownResponse(email, cooldownUntil, inviteErr.message);
        }

        return NextResponse.json({ error: inviteErr.message, code: "BAD_REQUEST" }, { status: 400 });
      }

      if (shouldUseResend) {
        const actionLink = ensureSupabaseRedirect(inviteData.properties?.action_link ?? "", redirectTo);
        if (!actionLink) {
          return NextResponse.json({ error: "No se pudo generar el enlace de invitación", code: "BAD_REQUEST" }, { status: 400 });
        }
        try {
          await sendAuthEmail({
            kind: "invite",
            to: email,
            actionUrl: actionLink,
            organizationName: org?.name ?? null,
          });
        } catch (sendError: unknown) {
          const message = sendError instanceof Error ? sendError.message : "Failed to send invite email";
          const providerError = sendError instanceof AuthEmailProviderError ? sendError : null;
          if (providerError?.status === 429) {
            const cooldownUntil = new Date(Date.now() + INVITE_EMAIL_COOLDOWN_MS).toISOString();
            const { error: cooldownWriteErr } = await db.from("organization_invite_email_cooldowns").upsert(
              {
                organization_id: organizationId,
                email,
                cooldown_until: cooldownUntil,
                last_error: message,
                last_requested_by: requester.id,
              },
              { onConflict: "organization_id,email" }
            );
            if (cooldownWriteErr) throw cooldownWriteErr;
            return buildCooldownResponse(email, cooldownUntil, message);
          }
          return NextResponse.json({ error: message, code: "BAD_REQUEST" }, { status: 400 });
        }
      }

      invitedUserId = inviteData.user?.id ?? null;

      const { error: cooldownClearErr } = await db
        .from("organization_invite_email_cooldowns")
        .delete()
        .eq("organization_id", organizationId)
        .eq("email", email);
      if (cooldownClearErr) throw cooldownClearErr;
    }

    if (!invitedUserId) {
      return NextResponse.json(
        { error: "No se pudo resolver el usuario invitado. Pídele iniciar sesión una vez e intenta de nuevo.", code: "INVITED_USER_NOT_RESOLVED" },
        { status: 400 }
      );
    }

    // profiles usa user_id como clave
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
        role: effectiveRole,
        member_type_id: effectiveMemberTypeId,
      },
      { onConflict: "organization_id,user_id" }
    );

    if (memberErr) throw memberErr;

    return NextResponse.json({
      ok: true,
      invited_email: email,
      delivery: inviteDelivery,
      membership_role: effectiveRole,
      member_type_id: effectiveMemberTypeId,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
