"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type BusyAction = "password" | null;

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");
  const [password, setPassword] = useState("");

  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const busy = busyAction !== null;
  const [msg, setMsg] = useState("");
  const inFlightRef = useRef<BusyAction>(null);

  function humanizeAuthErrorMessage(raw: string) {
    const lower = raw.toLowerCase();
    if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429")) {
      return "Demasiados intentos en poco tiempo. Espera un minuto y vuelve a intentar.";
    }
    if (lower.includes("email not confirmed")) {
      return "Tu correo aún no está confirmado. Revisa tu bandeja si tu proyecto exige confirmación por email.";
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

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(10,95,88,0.08),transparent_22%),radial-gradient(circle_at_100%_0%,rgba(45,79,135,0.08),transparent_24%),linear-gradient(180deg,#f5f8fb_0%,#eff4f8_100%)] px-4 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-[380px] items-center justify-center">
        <Card className="w-full rounded-[30px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(250,252,255,0.88))] shadow-[0_28px_70px_-42px_rgba(15,23,42,0.34)] backdrop-blur-2xl">
          <CardContent className="px-6 py-9 sm:px-8 sm:py-10">
            <div className="flex flex-col items-center text-center">
              {platformLogoUrl ? (
                <div className="rounded-[24px] border border-slate-200/90 bg-white p-2 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)]">
                  <Image
                    src={platformLogoUrl}
                    alt="Logo plataforma"
                    width={108}
                    height={108}
                    className="h-20 w-20 rounded-[18px] object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-[radial-gradient(circle_at_top,rgba(45,79,135,0.16),transparent_62%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(243,247,252,0.98))] ring-1 ring-slate-200/80 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.42)]">
                  <div className="flex h-20 w-20 items-center justify-center rounded-[22px] bg-slate-900 text-xl font-semibold text-white">
                    OA
                  </div>
                </div>
              )}
              <div className="mt-6 text-[10px] uppercase tracking-[0.28em] text-slate-500">Ops Ahead</div>
              <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.03em] text-slate-950">Iniciar sesión</h1>
              <p className="mt-2 max-w-[24ch] text-sm leading-6 text-slate-500">
                Accede con tu correo y contraseña
              </p>
            </div>

            <form onSubmit={loginWithPassword} className="mt-9 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Email</Label>
                <Input
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  className="h-12 rounded-[18px] border-slate-200 bg-white/90 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Contraseña</Label>
                <Input
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="h-12 rounded-[18px] border-slate-200 bg-white/90 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
                />
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="mt-3 h-12 w-full rounded-[18px] bg-[linear-gradient(180deg,#1f3d6e,#183359)] text-white shadow-[0_18px_36px_-24px_rgba(24,51,89,0.7)] hover:brightness-105"
              >
                {busyAction === "password" ? "Entrando..." : "Entrar"}
              </Button>
            </form>

            {msg ? (
              <div className="mt-4 rounded-[18px] border border-[var(--accent)]/12 bg-[linear-gradient(180deg,rgba(231,238,249,0.9),rgba(241,245,252,0.92))] px-4 py-3 text-sm leading-6 text-slate-700">
                {msg}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
