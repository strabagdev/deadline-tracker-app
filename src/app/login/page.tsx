"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type Mode = "password" | "magic";
type BusyAction = "password" | "magic" | "reset" | null;

const AUTH_EMAIL_COOLDOWN_MS = 75_000;

function toStorageSafeEmail(email: string) {
  return encodeURIComponent(email.trim().toLowerCase());
}

function getMagicCooldownKey(email: string) {
  return `auth:magicCooldown:${toStorageSafeEmail(email)}`;
}

function getResetCooldownKey(email: string) {
  return `auth:resetCooldown:${toStorageSafeEmail(email)}`;
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");

  const [email, setEmail] = useState("");
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);

  const [password, setPassword] = useState("");

  // "busy" global, pero además sabemos qué acción está corriendo
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const busy = busyAction !== null;

  const [msg, setMsg] = useState("");

  // Locks para impedir doble ejecución aunque el usuario doble-click / enter / etc.
  const inFlightRef = useRef<BusyAction>(null);

  // Cooldowns para evitar spamear OTP / reset
  const [magicCooldownUntil, setMagicCooldownUntil] = useState<number>(0);
  const [resetCooldownUntil, setResetCooldownUntil] = useState<number>(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const canSendMagic = nowTs > magicCooldownUntil;
  const canSendReset = nowTs > resetCooldownUntil;

  function getBaseUrl() {
    // En cliente, esto es confiable en dev; en prod, NEXT_PUBLIC_APP_URL es mejor.
    return process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
  }

  function humanizeAuthErrorMessage(raw: string) {
    const lower = raw.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
      return (
        "Estás intentando enviar demasiados correos en poco tiempo (límite de Supabase).\n" +
        "Espera un minuto y vuelve a intentar."
      );
    }
    return raw;
  }

  function getRetrySecondsFromMessage(raw: string): number | null {
    const lower = raw.toLowerCase();
    // Ejemplos comunes: "For security purposes, you can only request this once every 60 seconds"
    // o mensajes que incluyen "after 23 seconds"
    const match = lower.match(/(\d+)\s*seconds?/);
    if (!match) return null;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  function persistCooldowns(emailValue: string, cooldownUntil: number) {
    if (!emailValue) return;
    try {
      window.localStorage.setItem(getMagicCooldownKey(emailValue), String(cooldownUntil));
      window.localStorage.setItem(getResetCooldownKey(emailValue), String(cooldownUntil));
    } catch {
      // noop
    }
  }

  function applyCooldownUntil(cooldownUntil: number) {
    setMagicCooldownUntil(cooldownUntil);
    setResetCooldownUntil(cooldownUntil);
    persistCooldowns(normalizedEmail, cooldownUntil);
  }

  async function syncProfileFromSession() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/profile/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || "No se pudo sincronizar el perfil");
    }
  }

  async function resolvePostAuthRoute(token: string) {
    const res = await fetch("/api/platform/super-admin/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json && json.has_super_admin === false) {
      return "/setup-super-admin";
    }
    return "/select-org";
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      if (!cancelled && data.session) {
        const route = await resolvePostAuthRoute(data.session.access_token);
        router.replace(route);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    if (!normalizedEmail) {
      setMagicCooldownUntil(0);
      setResetCooldownUntil(0);
      return;
    }

    try {
      const magicRaw = window.localStorage.getItem(getMagicCooldownKey(normalizedEmail));
      const resetRaw = window.localStorage.getItem(getResetCooldownKey(normalizedEmail));
      const magicUntil = magicRaw ? Number(magicRaw) : 0;
      const resetUntil = resetRaw ? Number(resetRaw) : 0;
      setMagicCooldownUntil(Number.isFinite(magicUntil) ? magicUntil : 0);
      setResetCooldownUntil(Number.isFinite(resetUntil) ? resetUntil : 0);
    } catch {
      setMagicCooldownUntil(0);
      setResetCooldownUntil(0);
    }
  }, [normalizedEmail]);

  useEffect(() => {
    const hasActiveCooldown = magicCooldownUntil > nowTs || resetCooldownUntil > nowTs;
    if (!hasActiveCooldown) return;

    const id = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => window.clearInterval(id);
  }, [magicCooldownUntil, resetCooldownUntil, nowTs]);

  async function loginWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!normalizedEmail || !password) {
      setMsg("Ingresa email y contraseña.");
      return;
    }

    // Lock fuerte anti doble submit
    if (inFlightRef.current) return;
    inFlightRef.current = "password";
    setBusyAction("password");

    try {
      const { error } = await supabaseAuth.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error) {
        setMsg(humanizeAuthErrorMessage(error.message));
        return;
      }

      try {
        await syncProfileFromSession();
      } catch (syncError) {
        const message =
          syncError instanceof Error ? syncError.message : "No se pudo sincronizar el perfil";
        setMsg(message);
        return;
      }

      const { data } = await supabaseAuth.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setMsg("No se pudo validar sesión.");
        return;
      }
      const route = await resolvePostAuthRoute(token);
      router.replace(route);
    } finally {
      setBusyAction(null);
      inFlightRef.current = null;
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!normalizedEmail) {
      setMsg("Ingresa un email válido.");
      return;
    }

    if (!canSendMagic) {
      const seconds = Math.max(1, Math.ceil((magicCooldownUntil - Date.now()) / 1000));
      setMsg(`Espera ${seconds}s para reenviar el magic link.`);
      return;
    }

    // Lock fuerte anti doble submit
    if (inFlightRef.current) return;
    inFlightRef.current = "magic";
    setBusyAction("magic");

    // Inicia cooldown al momento de intentar (evita spam aunque falle por doble click)
    applyCooldownUntil(Date.now() + AUTH_EMAIL_COOLDOWN_MS);

    try {
      const baseUrl = getBaseUrl();
      const redirectTo = `${baseUrl}/auth/callback`;

      const { error } = await supabaseAuth.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: redirectTo },
      });

      if (error) {
        const retrySeconds = getRetrySecondsFromMessage(error.message);
        if (retrySeconds) {
          applyCooldownUntil(Date.now() + retrySeconds * 1000 + 2_000);
        }
        setMsg(humanizeAuthErrorMessage(error.message));
        return;
      }

      setMsg("Listo. Revisa tu correo para el link de acceso.");
    } finally {
      setBusyAction(null);
      inFlightRef.current = null;
    }
  }

  async function sendPasswordReset() {
    setMsg("");

    if (!normalizedEmail) {
      setMsg("Ingresa un email válido para restablecer contraseña.");
      return;
    }

    if (!canSendReset) {
      const seconds = Math.max(1, Math.ceil((resetCooldownUntil - Date.now()) / 1000));
      setMsg(`Espera ${seconds}s para reenviar el correo de restablecimiento.`);
      return;
    }

    // Lock fuerte anti doble click
    if (inFlightRef.current) return;
    inFlightRef.current = "reset";
    setBusyAction("reset");

    applyCooldownUntil(Date.now() + AUTH_EMAIL_COOLDOWN_MS);

    try {
      const baseUrl = getBaseUrl();
      const redirectTo = `${baseUrl}/reset-password`;

      const { error } = await supabaseAuth.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo,
      });

      if (error) {
        const retrySeconds = getRetrySecondsFromMessage(error.message);
        if (retrySeconds) {
          applyCooldownUntil(Date.now() + retrySeconds * 1000 + 2_000);
        }
        setMsg(humanizeAuthErrorMessage(error.message));
        return;
      }

      setMsg("Te envié un correo para restablecer tu contraseña.");
    } finally {
      setBusyAction(null);
      inFlightRef.current = null;
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Iniciar sesión</h1>

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button
          type="button"
          onClick={() => setMode("password")}
          disabled={busy}
          style={{ padding: 10, flex: 1, opacity: mode === "password" ? 1 : 0.6 }}
        >
          Con contraseña
        </button>
        <button
          type="button"
          onClick={() => setMode("magic")}
          disabled={busy}
          style={{ padding: 10, flex: 1, opacity: mode === "magic" ? 1 : 0.6 }}
        >
          Magic link
        </button>
      </div>

      <label>Email</label>
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="tu@correo.com"
        style={{ width: "100%", padding: 10, marginTop: 6 }}
        type="email"
        required
        autoComplete="email"
        inputMode="email"
      />

      {mode === "password" ? (
        <form onSubmit={loginWithPassword}>
          <label style={{ marginTop: 10, display: "block" }}>Contraseña</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            type="password"
            required
            autoComplete="current-password"
          />

          <button type="submit" disabled={busy} style={{ width: "100%", padding: 10, marginTop: 12 }}>
            {busyAction === "password" ? "Entrando..." : "Entrar"}
          </button>

          <button
            type="button"
            disabled={busy || !normalizedEmail}
            onClick={sendPasswordReset}
            style={{ width: "100%", padding: 10, marginTop: 10 }}
          >
            {busyAction === "reset"
              ? "Enviando..."
              : !canSendReset
              ? `Espera ${Math.max(1, Math.ceil((resetCooldownUntil - nowTs) / 1000))}s`
              : "Restablecer contraseña"}
          </button>
        </form>
      ) : (
        <form onSubmit={sendMagicLink}>
          <button
            type="submit"
            disabled={busy || !normalizedEmail}
            style={{ width: "100%", padding: 10, marginTop: 12 }}
          >
            {busyAction === "magic"
              ? "Enviando..."
              : !canSendMagic
              ? `Espera ${Math.max(1, Math.ceil((magicCooldownUntil - nowTs) / 1000))}s`
              : "Enviar magic link"}
          </button>
        </form>
      )}

      {msg && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</p>}
    </main>
  );
}
