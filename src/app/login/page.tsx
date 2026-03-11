"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BusyAction = "password" | "register" | "magic_link" | "reset" | "oauth_google" | "oauth_microsoft" | null;
type AuthMode = "signin" | "signup";

const AUTH_EMAIL_COOLDOWN_MS = 75_000;

function toStorageSafeEmail(email: string) {
  return encodeURIComponent(email.trim().toLowerCase());
}

function getCooldownKey(kind: "magic" | "reset", email: string) {
  return `auth:${kind}Cooldown:${toStorageSafeEmail(email)}`;
}

function getAuthPublicOrigin() {
  const envOrigin = String(process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (envOrigin) return envOrigin.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location.origin) return window.location.origin;
  return "http://localhost:3000";
}

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showMagicLink, setShowMagicLink] = useState(false);

  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const busy = busyAction !== null;
  const [msg, setMsg] = useState("");
  const inFlightRef = useRef<BusyAction>(null);

  const [resetCooldownUntil, setResetCooldownUntil] = useState<number>(0);
  const [magicCooldownUntil, setMagicCooldownUntil] = useState<number>(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const canSendReset = nowTs > resetCooldownUntil;
  const canSendMagicLink = nowTs > magicCooldownUntil;

  function humanizeAuthErrorMessage(raw: string) {
    const lower = raw.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
      return (
        "Estás intentando enviar demasiados correos en poco tiempo.\n" +
        "Espera un minuto y vuelve a intentar."
      );
    }
    if (lower.includes("email not confirmed")) {
      return "Tu correo aún no está confirmado. Si tu proyecto exige confirmación por email, revisa tu bandeja o usa SSO.";
    }
    return raw;
  }

  function getRetrySecondsFromMessage(raw: string): number | null {
    const lower = raw.toLowerCase();
    const match = lower.match(/(\d+)\s*seconds?/);
    if (!match) return null;
    const seconds = Number(match[1]);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  function persistCooldown(kind: "magic" | "reset", emailValue: string, cooldownUntil: number) {
    if (!emailValue) return;
    try {
      window.localStorage.setItem(getCooldownKey(kind, emailValue), String(cooldownUntil));
    } catch {
      // noop
    }
  }

  function applyCooldown(kind: "magic" | "reset", cooldownUntil: number) {
    if (kind === "magic") {
      setMagicCooldownUntil(cooldownUntil);
    } else {
      setResetCooldownUntil(cooldownUntil);
    }
    persistCooldown(kind, normalizedEmail, cooldownUntil);
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
    if (res.ok && json && json.is_super_admin === true) {
      return "/app/super-admin";
    }
    return "/select-org";
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const brandingRes = await fetch("/api/platform/branding");
      const brandingJson = await brandingRes.json().catch(() => ({}));
      if (!cancelled && brandingRes.ok) {
        setPlatformLogoUrl(brandingJson?.platform?.logo_url ?? "");
      }

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
      const magicRaw = window.localStorage.getItem(getCooldownKey("magic", normalizedEmail));
      const resetRaw = window.localStorage.getItem(getCooldownKey("reset", normalizedEmail));
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

  async function finalizeSignedInSession() {
    await syncProfileFromSession();
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("No se pudo validar sesión.");
    const route = await resolvePostAuthRoute(token);
    router.replace(route);
  }

  async function loginWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!normalizedEmail || !password) {
      setMsg("Ingresa email y contraseña.");
      return;
    }

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

      await finalizeSignedInSession();
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "No se pudo iniciar sesión.");
    } finally {
      setBusyAction(null);
      inFlightRef.current = null;
    }
  }

  async function registerWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");

    if (!normalizedEmail || !password) {
      setMsg("Ingresa email y contraseña.");
      return;
    }
    if (password.length < 8) {
      setMsg("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setMsg("La confirmación de contraseña no coincide.");
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = "register";
    setBusyAction("register");

    try {
      const { data, error } = await supabaseAuth.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${getAuthPublicOrigin()}/auth/callback`,
        },
      });

      if (error) {
        setMsg(humanizeAuthErrorMessage(error.message));
        return;
      }

      if (data.session) {
        await finalizeSignedInSession();
        return;
      }

      setMsg(
        "Cuenta creada. Si en Supabase está activa la confirmación de correo, revisa tu bandeja. Si no, podrás iniciar sesión de inmediato con tu contraseña."
      );
      setMode("signin");
      setConfirmPassword("");
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "No se pudo crear la cuenta.");
    } finally {
      setBusyAction(null);
      inFlightRef.current = null;
    }
  }

  async function startOAuth(provider: "google" | "azure") {
    setMsg("");
    if (inFlightRef.current) return;
    const action: BusyAction = provider === "google" ? "oauth_google" : "oauth_microsoft";
    inFlightRef.current = action;
    setBusyAction(action);

    try {
      const { error } = await supabaseAuth.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${getAuthPublicOrigin()}/auth/callback`,
          queryParams:
            provider === "azure"
              ? { prompt: "select_account" }
              : { prompt: "select_account" },
        },
      });

      if (error) {
        setMsg(humanizeAuthErrorMessage(error.message));
      }
    } finally {
      setBusyAction(null);
      inFlightRef.current = null;
    }
  }

  async function sendMagicLink() {
    setMsg("");

    if (!normalizedEmail) {
      setMsg("Ingresa un email válido para continuar con magic link.");
      return;
    }

    if (!canSendMagicLink) {
      const seconds = Math.max(1, Math.ceil((magicCooldownUntil - Date.now()) / 1000));
      setMsg(`Espera ${seconds}s para reenviar el magic link.`);
      return;
    }

    if (inFlightRef.current) return;
    inFlightRef.current = "magic_link";
    setBusyAction("magic_link");
    applyCooldown("magic", Date.now() + AUTH_EMAIL_COOLDOWN_MS);

    try {
      const { error } = await supabaseAuth.auth.signInWithOtp({
        email: normalizedEmail,
        options: {
          emailRedirectTo: `${getAuthPublicOrigin()}/auth/callback`,
          shouldCreateUser: false,
        },
      });

      if (error) {
        const retrySeconds = getRetrySecondsFromMessage(error.message);
        if (retrySeconds) {
          applyCooldown("magic", Date.now() + retrySeconds * 1000 + 2_000);
        }
        setMsg(humanizeAuthErrorMessage(error.message));
        return;
      }

      setMsg("Te envié un magic link. Úsalo como método de respaldo si no quieres entrar con contraseña o SSO.");
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

    if (inFlightRef.current) return;
    inFlightRef.current = "reset";
    setBusyAction("reset");
    applyCooldown("reset", Date.now() + AUTH_EMAIL_COOLDOWN_MS);

    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = String(json?.error || "No se pudo enviar el correo de restablecimiento.");
        const retrySeconds = getRetrySecondsFromMessage(message);
        if (retrySeconds) {
          applyCooldown("reset", Date.now() + retrySeconds * 1000 + 2_000);
        }
        setMsg(humanizeAuthErrorMessage(message));
        return;
      }

      setMsg("Te envié un correo para restablecer tu contraseña.");
    } finally {
      setBusyAction(null);
      inFlightRef.current = null;
    }
  }

  return (
    <main className="mx-auto mt-4 w-full max-w-xl px-3 sm:mt-10 sm:px-4">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-3 border-b border-[color:var(--border)] bg-[linear-gradient(135deg,#ecfeff_0%,#f8fafc_55%,#ffffff_100%)]">
          {platformLogoUrl ? (
            <div className="flex justify-center pb-1">
              <Image
                src={platformLogoUrl}
                alt="Logo plataforma"
                width={110}
                height={110}
                className="h-[96px] w-[96px] rounded-2xl object-cover shadow-sm"
              />
            </div>
          ) : null}
          <div className="space-y-1 text-center">
            <CardTitle className="text-2xl">Acceso a Ops Ahead</CardTitle>
            <CardDescription>
              Prioriza SSO y contraseña. Magic link queda como respaldo para usuarios existentes.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="w-full justify-center"
              onClick={() => void startOAuth("azure")}
            >
              {busyAction === "oauth_microsoft" ? "Conectando..." : "Continuar con Microsoft"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              className="w-full justify-center"
              onClick={() => void startOAuth("google")}
            >
              {busyAction === "oauth_google" ? "Conectando..." : "Continuar con Google"}
            </Button>
          </div>

          <div className="flex items-center gap-3 text-xs uppercase tracking-[0.24em] text-slate-400">
            <div className="h-px flex-1 bg-[color:var(--border)]" />
            <span>o entra con correo</span>
            <div className="h-px flex-1 bg-[color:var(--border)]" />
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-[var(--radius-md)] bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setMode("signin")}
              className={`rounded-[calc(var(--radius-md)-4px)] px-3 py-2 text-sm font-medium transition-colors ${
                mode === "signin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Correo + contraseña
            </button>
            <button
              type="button"
              onClick={() => setMode("signup")}
              className={`rounded-[calc(var(--radius-md)-4px)] px-3 py-2 text-sm font-medium transition-colors ${
                mode === "signup" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
              }`}
            >
              Crear cuenta
            </button>
          </div>

          {mode === "signin" ? (
            <form onSubmit={loginWithPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  required
                  autoComplete="current-password"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Button type="submit" disabled={busy} className="w-full">
                  {busyAction === "password" ? "Entrando..." : "Entrar"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !normalizedEmail}
                  onClick={sendPasswordReset}
                  className="w-full sm:w-auto"
                >
                  {busyAction === "reset"
                    ? "Enviando..."
                    : !canSendReset
                    ? `Espera ${Math.max(1, Math.ceil((resetCooldownUntil - nowTs) / 1000))}s`
                    : "Reset password"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={registerWithPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-password">Contraseña</Label>
                <Input
                  id="signup-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="signup-confirm-password">Confirmar contraseña</Label>
                <Input
                  id="signup-confirm-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite tu contraseña"
                  type="password"
                  required
                  autoComplete="new-password"
                />
              </div>

              <p className="text-sm text-slate-500">
                Crear una cuenta no asigna acceso a una organización por sí solo. En entornos multiempresa, el acceso final depende de invitación o membresía.
              </p>

              <Button type="submit" disabled={busy} className="w-full">
                {busyAction === "register" ? "Creando cuenta..." : "Crear cuenta"}
              </Button>
            </form>
          )}

          <div className="rounded-[var(--radius-md)] border border-dashed border-[color:var(--border)] bg-slate-50/80 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-slate-900">Magic link</div>
                <div className="text-sm text-slate-500">Úsalo solo como respaldo si tu organización ya depende de ese flujo.</div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowMagicLink((v) => !v)}>
                {showMagicLink ? "Ocultar" : "Mostrar"}
              </Button>
            </div>

            {showMagicLink ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !normalizedEmail || !canSendMagicLink}
                  onClick={sendMagicLink}
                  className="w-full sm:w-auto"
                >
                  {busyAction === "magic_link"
                    ? "Enviando..."
                    : !canSendMagicLink
                    ? `Espera ${Math.max(1, Math.ceil((magicCooldownUntil - nowTs) / 1000))}s`
                    : "Enviar magic link"}
                </Button>
              </div>
            ) : null}
          </div>

          {msg ? <p className="whitespace-pre-wrap text-sm text-slate-700">{msg}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
