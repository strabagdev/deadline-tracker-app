"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BusyAction = "password" | "reset" | null;

const AUTH_EMAIL_COOLDOWN_MS = 75_000;

function toStorageSafeEmail(email: string) {
  return encodeURIComponent(email.trim().toLowerCase());
}

function getResetCooldownKey(email: string) {
  return `auth:resetCooldown:${toStorageSafeEmail(email)}`;
}

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");

  const [password, setPassword] = useState("");

  // "busy" global, pero además sabemos qué acción está corriendo
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const busy = busyAction !== null;

  const [msg, setMsg] = useState("");

  // Locks para impedir doble ejecución aunque el usuario doble-click / enter / etc.
  const inFlightRef = useRef<BusyAction>(null);

  // Cooldowns para evitar spamear OTP / reset
  const [resetCooldownUntil, setResetCooldownUntil] = useState<number>(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const canSendReset = nowTs > resetCooldownUntil;

  function getBaseUrl() {
    // Prioriza el origen real del browser para evitar links con host desactualizado.
    return window.location.origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
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

  function persistCooldown(emailValue: string, cooldownUntil: number) {
    if (!emailValue) return;
    try {
      window.localStorage.setItem(getResetCooldownKey(emailValue), String(cooldownUntil));
    } catch {
      // noop
    }
  }

  function applyCooldownUntil(cooldownUntil: number) {
    setResetCooldownUntil(cooldownUntil);
    persistCooldown(normalizedEmail, cooldownUntil);
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
      setResetCooldownUntil(0);
      return;
    }

    try {
      const resetRaw = window.localStorage.getItem(getResetCooldownKey(normalizedEmail));
      const resetUntil = resetRaw ? Number(resetRaw) : 0;
      setResetCooldownUntil(Number.isFinite(resetUntil) ? resetUntil : 0);
    } catch {
      setResetCooldownUntil(0);
    }
  }, [normalizedEmail]);

  useEffect(() => {
    const hasActiveCooldown = resetCooldownUntil > nowTs;
    if (!hasActiveCooldown) return;

    const id = window.setInterval(() => {
      setNowTs(Date.now());
    }, 1000);

    return () => window.clearInterval(id);
  }, [resetCooldownUntil, nowTs]);

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

      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          redirectTo,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = String(json?.error || "No se pudo enviar el correo de restablecimiento.");
        const retrySeconds = getRetrySecondsFromMessage(message);
        if (retrySeconds) {
          applyCooldownUntil(Date.now() + retrySeconds * 1000 + 2_000);
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
    <main className="mx-auto mt-10 w-full max-w-md px-4">
      <Card>
        <CardHeader className="space-y-2">
          {platformLogoUrl ? (
            <div className="flex justify-center pb-2">
              <img
                src={platformLogoUrl}
                alt="Logo plataforma"
                width={110}
                height={110}
                className="h-[110px] w-[110px] rounded-xl object-cover"
              />
            </div>
          ) : null}
          <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
          <CardDescription>Acceso por contraseña para miembros y administradores.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={loginWithPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
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

            <Button type="submit" disabled={busy} className="w-full">
              {busyAction === "password" ? "Entrando..." : "Entrar"}
            </Button>

            <Button
              type="button"
              variant="outline"
              disabled={busy || !normalizedEmail}
              onClick={sendPasswordReset}
              className="w-full"
            >
              {busyAction === "reset"
                ? "Enviando..."
                : !canSendReset
                ? `Espera ${Math.max(1, Math.ceil((resetCooldownUntil - nowTs) / 1000))}s`
                : "Restablecer contraseña"}
            </Button>
          </form>

          {msg ? <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{msg}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
