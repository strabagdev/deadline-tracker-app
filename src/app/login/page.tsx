"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BusyAction = "password" | "register" | "magic_link" | "reset" | null;
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
        router.replace("/select-org");
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
    if (!data.session?.access_token) throw new Error("No se pudo validar sesión.");
    router.replace("/select-org");
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

      if (data.user?.id) {
        const requestRes = await fetch("/api/auth/access-request/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: data.user.id,
            email: normalizedEmail,
          }),
        });
        const requestJson = await requestRes.json().catch(() => ({}));
        if (!requestRes.ok) {
          setMsg(requestJson.error || "La cuenta fue creada, pero no se pudo registrar la solicitud para superadmin.");
          return;
        }
      }

      setMsg(
        "Cuenta creada y solicitud enviada al superadmin. Si en Supabase está activa la confirmación de correo, revisa tu bandeja antes de iniciar sesión."
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(15,118,110,0.12),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(45,79,135,0.12),transparent_28%),linear-gradient(180deg,#f3f7fb_0%,#edf4f0_100%)] px-3 py-4 sm:px-4 sm:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-[1320px] gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="hidden overflow-hidden rounded-[34px] border border-white/45 bg-[linear-gradient(140deg,rgba(10,31,33,0.98),rgba(9,88,81,0.92))] px-8 py-8 text-white shadow-[0_30px_90px_rgba(15,23,42,0.16)] lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="flex items-center gap-4">
              {platformLogoUrl ? (
                <Image
                  src={platformLogoUrl}
                  alt="Logo plataforma"
                  width={88}
                  height={88}
                  className="h-[72px] w-[72px] rounded-2xl border border-white/10 object-cover shadow-[0_16px_40px_rgba(0,0,0,0.18)]"
                />
              ) : (
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-lg font-semibold">
                  OA
                </div>
              )}
              <div>
                <div className="text-xs uppercase tracking-[0.32em] text-emerald-200/78">Ops Ahead</div>
                <div className="mt-2 text-sm text-white/62">Control operativo de vencimientos, uso y cobertura.</div>
              </div>
            </div>

            <h1 className="mt-10 max-w-xl text-5xl font-semibold leading-[1.02] tracking-tight">
              Entra al centro de control donde el forecast ya viene resuelto.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/72">
              Ops Ahead organiza entidades, vencimientos y registros de uso para que la operación lea el estado real
              sin recalcular en cada pantalla. Aquí el foco está en cobertura, presión de agenda y trazabilidad.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[26px] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/58">Forecast</div>
              <div className="mt-3 text-lg font-semibold">Precalculado</div>
              <p className="mt-2 text-sm leading-6 text-white/65">La plataforma privilegia lecturas operativas ya resueltas y no cálculos pesados al cargar.</p>
            </div>
            <div className="rounded-[26px] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/58">Uso</div>
              <div className="mt-3 text-lg font-semibold">Trazable</div>
              <p className="mt-2 text-sm leading-6 text-white/65">Los registros quedan ordenados cronológicamente para sostener cálculo, historia y analítica.</p>
            </div>
            <div className="rounded-[26px] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/58">Acceso</div>
              <div className="mt-3 text-lg font-semibold">Multiempresa</div>
              <p className="mt-2 text-sm leading-6 text-white/65">Las cuentas pueden quedar pendientes de aprobación y asignación organizacional por superadmin.</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center lg:px-10">
          <Card className="w-full max-w-md overflow-hidden bg-white/86 backdrop-blur">
            <CardHeader className="pb-5">
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">Acceso seguro</div>
                <CardTitle className="text-3xl tracking-tight">
                  {mode === "signin" ? "Entrar a Ops Ahead" : "Crear cuenta de acceso"}
                </CardTitle>
                <CardDescription className="text-sm leading-6">
                  Prioriza SSO o contraseña. Magic link queda como respaldo para usuarios existentes.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-2 gap-2 rounded-[18px] bg-[rgba(215,243,239,0.42)] p-1.5">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className={`rounded-[14px] px-3 py-2.5 text-sm font-medium transition-colors ${
                    mode === "signin" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`rounded-[14px] px-3 py-2.5 text-sm font-medium transition-colors ${
                    mode === "signup" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  Crear cuenta
                </button>
              </div>

              {mode === "signin" ? (
                <form onSubmit={loginWithPassword} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="email">Email corporativo</Label>
                      <Input
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tu@empresa.com"
                        type="email"
                        required
                        autoComplete="email"
                        inputMode="email"
                        className="h-11 rounded-2xl bg-white"
                      />
                    </div>

                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="password">Contraseña</Label>
                      <Input
                        id="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        type="password"
                        required
                        autoComplete="current-password"
                        className="h-11 rounded-2xl bg-white"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <Button type="submit" disabled={busy} className="h-11 w-full rounded-2xl">
                      {busyAction === "password" ? "Entrando..." : "Entrar"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || !normalizedEmail}
                      onClick={sendPasswordReset}
                      className="h-11 w-full rounded-2xl sm:w-auto"
                    >
                      {busyAction === "reset"
                        ? "Enviando..."
                        : !canSendReset
                        ? `Espera ${Math.max(1, Math.ceil((resetCooldownUntil - nowTs) / 1000))}s`
                        : "Restablecer"}
                    </Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={registerWithPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email corporativo</Label>
                    <Input
                      id="signup-email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="tu@empresa.com"
                      type="email"
                      required
                      autoComplete="email"
                      inputMode="email"
                      className="h-11 rounded-2xl bg-white"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
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
                        className="h-11 rounded-2xl bg-white"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-confirm-password">Confirmar</Label>
                      <Input
                        id="signup-confirm-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repite tu contraseña"
                        type="password"
                        required
                        autoComplete="new-password"
                        className="h-11 rounded-2xl bg-white"
                      />
                    </div>
                  </div>

                  <div className="rounded-[20px] border border-[rgba(17,32,28,0.08)] bg-[rgba(215,243,239,0.28)] px-4 py-3 text-sm leading-6 text-slate-600">
                    Crear una cuenta no asigna acceso por sí solo. En entornos multiempresa, el acceso final depende
                    de invitación, membresía o aprobación del superadmin.
                  </div>

                  <Button type="submit" disabled={busy} className="h-11 w-full rounded-2xl">
                    {busyAction === "register" ? "Creando cuenta..." : "Crear cuenta"}
                  </Button>
                </form>
              )}

              <div className="rounded-[22px] border border-dashed border-[color:var(--border)] bg-[rgba(244,247,251,0.7)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">Magic link</div>
                    <div className="text-sm leading-6 text-slate-500">
                      Déjalo como respaldo si tu organización ya opera con ese flujo.
                    </div>
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
                      className="h-11 rounded-2xl bg-white"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy || !normalizedEmail || !canSendMagicLink}
                      onClick={sendMagicLink}
                      className="h-11 w-full rounded-2xl sm:w-auto"
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

              {msg ? (
                <div className="rounded-[18px] border border-[rgba(17,32,28,0.08)] bg-white px-4 py-3 text-sm leading-6 text-slate-700">
                  {msg}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
