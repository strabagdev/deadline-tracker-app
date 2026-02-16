export function parseOrganizationNamePayload(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const organizationName = String(payload.organizationName ?? "").trim();
  if (organizationName.length < 2) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "organizationName required (min 2 chars)", code: "BAD_REQUEST" },
    };
  }
  return { ok: true as const, organizationName };
}

export function parseOrganizationIdPayload(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const organizationId = String(payload.organizationId ?? "").trim();
  if (!organizationId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "organizationId required", code: "BAD_REQUEST" },
    };
  }
  return { ok: true as const, organizationId };
}

export function parsePlatformInvitePayload(
  body: unknown,
  validRoles: readonly string[]
) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const organizationId = String(payload.organizationId ?? "").trim();
  const email = String(payload.email ?? "").trim().toLowerCase();
  const role = String(payload.role ?? "member").trim().toLowerCase();

  if (!organizationId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "organizationId required", code: "BAD_REQUEST" },
    };
  }
  if (!email) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "email required", code: "BAD_REQUEST" },
    };
  }
  if (!validRoles.includes(role)) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "invalid role", code: "BAD_REQUEST" },
    };
  }
  return { ok: true as const, organizationId, email, role };
}

export function parseAssignOwnerPayload(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const organizationId = String(payload.organizationId ?? "").trim();
  const ownerEmail = String(payload.ownerEmail ?? "").trim().toLowerCase();

  if (!organizationId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "organizationId required", code: "BAD_REQUEST" },
    };
  }
  if (!ownerEmail) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "ownerEmail required", code: "BAD_REQUEST" },
    };
  }
  return { ok: true as const, organizationId, ownerEmail };
}

export function parseRemoveOwnerPayload(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const organizationId = String(payload.organizationId ?? "").trim();
  const ownerUserId = String(payload.ownerUserId ?? "").trim();

  if (!organizationId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "organizationId required", code: "BAD_REQUEST" },
    };
  }
  if (!ownerUserId) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "ownerUserId required", code: "BAD_REQUEST" },
    };
  }
  return { ok: true as const, organizationId, ownerUserId };
}
