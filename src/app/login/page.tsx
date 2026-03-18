"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BusyAction = "password" | "register" | null;
type AuthMode = "signin" | "signup";

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

  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const busy = busyAction !== null;
  const [msg, setMsg] = useState("");
  const inFlightRef = useRef<BusyAction>(null);

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
          <Card className="w-full max-w-md bg-white/86 backdrop-blur">
            <CardHeader className="pb-5">
              <div className="space-y-2">
                <div className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">Acceso seguro</div>
                <CardTitle className="text-3xl tracking-tight">
                  {mode === "signin" ? "Entrar a Ops Ahead" : "Crear cuenta de acceso"}
                </CardTitle>
                <CardDescription className="text-sm leading-6">
                  Ingresa con tu correo y contraseña o crea una cuenta para solicitar acceso.
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 pt-6">
              <div className="grid grid-cols-2 gap-2 rounded-[18px] bg-[var(--accent-soft)] p-1.5">
                <button
                  type="button"
                  onClick={() => setMode("signin")}
                  className={`rounded-[14px] px-3 py-2.5 text-sm font-medium transition-colors ${
                    mode === "signin"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm"
                      : "text-[var(--accent)]/75"
                  }`}
                >
                  Entrar
                </button>
                <button
                  type="button"
                  onClick={() => setMode("signup")}
                  className={`rounded-[14px] px-3 py-2.5 text-sm font-medium transition-colors ${
                    mode === "signup"
                      ? "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-sm"
                      : "text-[var(--accent)]/75"
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

                  <div className="grid gap-3">
                    <Button type="submit" disabled={busy} className="h-11 w-full rounded-2xl">
                      {busyAction === "password" ? "Entrando..." : "Entrar"}
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

                  <div className="rounded-[20px] border border-[var(--accent)]/12 bg-[var(--accent-soft)] px-4 py-3 text-sm leading-6 text-slate-700">
                    Crear una cuenta no asigna acceso por sí solo. En entornos multiempresa, el acceso final depende
                    de invitación, membresía o aprobación del superadmin.
                  </div>

                  <Button type="submit" disabled={busy} className="h-11 w-full rounded-2xl">
                    {busyAction === "register" ? "Creando cuenta..." : "Crear cuenta"}
                  </Button>
                </form>
              )}

              {msg ? (
                <div className="rounded-2xl border border-[var(--accent)]/12 bg-[var(--accent-soft)] px-4 py-3 text-sm leading-6 text-slate-700">
                  {msg}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-4 text-sm text-[var(--muted-foreground)]">
                <button
                  type="button"
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  className="font-medium text-[var(--accent)]"
                >
                  {mode === "signin" ? "¿Necesitas una cuenta?" : "¿Ya tienes una cuenta?"}
                </button>
                <span>{mode === "signin" ? "Cambiar a crear cuenta" : "Cambiar a entrar"}</span>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
