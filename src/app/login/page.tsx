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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(10,95,88,0.08),transparent_22%),radial-gradient(circle_at_100%_0%,rgba(45,79,135,0.08),transparent_24%),linear-gradient(180deg,#f5f8fb_0%,#eff4f8_100%)] px-3 py-4 sm:px-4 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-[380px] items-center justify-center sm:min-h-[calc(100vh-3rem)]">
        <Card className="w-full rounded-[26px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(250,252,255,0.88))] shadow-[0_24px_56px_-40px_rgba(15,23,42,0.32)] backdrop-blur-2xl sm:rounded-[30px] sm:shadow-[0_28px_70px_-42px_rgba(15,23,42,0.34)]">
          <CardContent className="px-5 py-7 sm:px-8 sm:py-10">
            <div className="flex flex-col items-center pt-6 text-center sm:pt-0">
              {platformLogoUrl ? (
                <div className="rounded-[20px] border border-slate-200/90 bg-white p-2 shadow-[0_20px_48px_-34px_rgba(15,23,42,0.24)] sm:rounded-[24px] sm:shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)]">
                  <Image
                    src={platformLogoUrl}
                    alt="Logo plataforma"
                    width={108}
                    height={108}
                    className="h-[72px] w-[72px] rounded-[16px] object-contain sm:h-20 sm:w-20 sm:rounded-[18px]"
                  />
                </div>
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-[24px] bg-[radial-gradient(circle_at_30%_18%,rgba(96,165,250,0.24),transparent_34%),radial-gradient(circle_at_70%_82%,rgba(14,165,233,0.12),transparent_42%),linear-gradient(180deg,#182235,#0b1220)] text-[2.2rem] font-semibold text-white ring-1 ring-slate-800/85 shadow-[0_14px_28px_-16px_rgba(15,23,42,0.48),0_8px_18px_-14px_rgba(15,23,42,0.28)] sm:h-28 sm:w-28 sm:rounded-[28px] sm:text-[2.5rem] sm:shadow-[0_16px_34px_-18px_rgba(15,23,42,0.52),0_8px_18px_-14px_rgba(15,23,42,0.32)]">
                  OA
                </div>
              )}
              <div className="mt-5 text-[10px] uppercase tracking-[0.24em] text-slate-500 sm:mt-6 sm:tracking-[0.28em]">Ops Ahead</div>
              <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-950 sm:text-[32px]">Iniciar sesión</h1>
              <p className="mt-1.5 max-w-[24ch] text-[13px] leading-5 text-slate-500 sm:mt-2 sm:text-sm sm:leading-6">
                Accede con tu correo y contraseña
              </p>
            </div>

            <form onSubmit={loginWithPassword} className="mt-7 space-y-3.5 sm:mt-9 sm:space-y-4">
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
                  className="h-11 rounded-[16px] border-slate-200 bg-white/90 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:h-12 sm:rounded-[18px]"
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
                  className="h-11 rounded-[16px] border-slate-200 bg-white/90 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:h-12 sm:rounded-[18px]"
                />
              </div>

              <Button
                type="submit"
                disabled={busy}
                className="mt-2 h-11 w-full rounded-[16px] bg-[radial-gradient(circle_at_30%_18%,rgba(96,165,250,0.18),transparent_38%),linear-gradient(180deg,#182235,#0b1220)] text-white shadow-[0_14px_26px_-16px_rgba(15,23,42,0.44),0_6px_14px_-12px_rgba(15,23,42,0.24)] hover:brightness-105 sm:mt-3 sm:h-12 sm:rounded-[18px]"
              >
                {busyAction === "password" ? "ENTRANDO..." : "ENTRAR"}
              </Button>
            </form>

            {msg ? (
              <div className="mt-4 rounded-[16px] border border-[var(--accent)]/12 bg-[linear-gradient(180deg,rgba(231,238,249,0.9),rgba(241,245,252,0.92))] px-4 py-3 text-sm leading-6 text-slate-700 sm:rounded-[18px]">
                {msg}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
