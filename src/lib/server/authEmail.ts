type AuthEmailKind = "invite" | "recovery";

type SendAuthEmailInput = {
  kind: AuthEmailKind;
  to: string;
  actionUrl: string;
  organizationName?: string | null;
};

export class AuthEmailProviderError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}

function getResendConfig() {
  const apiKey = String(process.env.RESEND_API_KEY ?? "").trim();
  const fromEmail = String(process.env.RESEND_FROM_EMAIL ?? "").trim();
  const fromName = String(process.env.RESEND_FROM_NAME ?? "Deadline Tracker").trim();

  if (!apiKey || !fromEmail) return null;
  return {
    apiKey,
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
  };
}

export function isResendConfigured() {
  return getResendConfig() !== null;
}

export function ensureSupabaseRedirect(actionUrl: string, redirectTo: string) {
  try {
    const url = new URL(actionUrl);
    url.searchParams.set("redirect_to", redirectTo);
    return url.toString();
  } catch {
    return actionUrl;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmailCopy(kind: AuthEmailKind, organizationName?: string | null) {
  if (kind === "invite") {
    return {
      subject: organizationName
        ? `Invitación a ${organizationName}`
        : "Invitación a Deadline Tracker",
      title: "Tienes una invitación pendiente",
      intro: organizationName
        ? `Fuiste invitado a unirte a ${organizationName}.`
        : "Fuiste invitado a unirte a Deadline Tracker.",
      actionLabel: "Aceptar invitación",
      outro: "El enlace abrirá el flujo seguro de Supabase Auth para activar tu acceso.",
    };
  }

  return {
    subject: "Restablece tu contraseña",
    title: "Solicitud de restablecimiento",
    intro: "Recibimos una solicitud para restablecer tu contraseña.",
    actionLabel: "Restablecer contraseña",
    outro: "Si no solicitaste este cambio, puedes ignorar este correo.",
  };
}

function buildEmailHtml(input: SendAuthEmailInput) {
  const copy = buildEmailCopy(input.kind, input.organizationName);
  return `
    <div style="background:#f8fafc;padding:32px 16px;font-family:Arial,sans-serif;color:#0f172a;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="font-size:24px;font-weight:700;line-height:1.2;margin-bottom:16px;">${escapeHtml(copy.title)}</div>
        <p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${escapeHtml(copy.intro)}</p>
        <p style="font-size:15px;line-height:1.6;margin:0 0 24px;">${escapeHtml(copy.outro)}</p>
        <a
          href="${escapeHtml(input.actionUrl)}"
          style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;"
        >
          ${escapeHtml(copy.actionLabel)}
        </a>
        <p style="font-size:12px;line-height:1.5;color:#475569;margin:24px 0 0;">
          Si el botón no funciona, copia este enlace en tu navegador:<br />
          <span style="word-break:break-all;">${escapeHtml(input.actionUrl)}</span>
        </p>
      </div>
    </div>
  `;
}

function buildEmailText(input: SendAuthEmailInput) {
  const copy = buildEmailCopy(input.kind, input.organizationName);
  return `${copy.title}

${copy.intro}
${copy.outro}

${copy.actionLabel}: ${input.actionUrl}`;
}

export async function sendAuthEmail(input: SendAuthEmailInput) {
  const resend = getResendConfig();
  if (!resend) {
    throw new AuthEmailProviderError("Resend is not configured", 500);
  }

  const copy = buildEmailCopy(input.kind, input.organizationName);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resend.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: resend.from,
      to: [input.to],
      subject: copy.subject,
      html: buildEmailHtml(input),
      text: buildEmailText(input),
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = String(
      (typeof json === "object" && json && "message" in json && json.message) ||
        (typeof json === "object" && json && "error" in json && json.error) ||
        "Failed to send email with Resend"
    );
    throw new AuthEmailProviderError(message, res.status);
  }

  return json;
}
