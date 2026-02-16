export function parseSuperAdminInitializePayload(body: unknown) {
  const payload = (body ?? {}) as Record<string, unknown>;
  const email = String(payload.email ?? "").trim().toLowerCase();
  const password = String(payload.password ?? "");
  const setupKey = String(payload.setupKey ?? "").trim();

  if (!email) return { ok: false as const, status: 400, body: { error: "email required", code: "BAD_REQUEST" } };
  if (password.length < 8) {
    return { ok: false as const, status: 400, body: { error: "password min length is 8", code: "BAD_REQUEST" } };
  }

  return { ok: true as const, email, password, setupKey };
}

export function validateSuperAdminSetupKey(input: { setupKey: string; expectedSetupKey?: string }) {
  const expected = input.expectedSetupKey;
  if (!expected) {
    return {
      ok: false as const,
      status: 500,
      body: { error: "Missing PLATFORM_SETUP_KEY in server environment", code: "INTERNAL_ERROR" },
    };
  }
  if (input.setupKey !== expected) {
    return { ok: false as const, status: 403, body: { error: "invalid setup key", code: "FORBIDDEN" } };
  }
  return { ok: true as const };
}

export function validateBootstrapConfirmPayload(input: { authEmail: string; confirmEmail: string }) {
  if (!input.authEmail) {
    return { ok: false as const, status: 400, body: { error: "Authenticated user has no email", code: "BAD_REQUEST" } };
  }
  if (!input.confirmEmail || input.confirmEmail !== input.authEmail) {
    return {
      ok: false as const,
      status: 400,
      body: { error: "Debes confirmar exactamente el correo autenticado para crear el super admin.", code: "BAD_REQUEST" },
    };
  }
  return { ok: true as const };
}
