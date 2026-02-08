"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type Mode = "password" | "magic";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      if (data.session) router.replace("/select-org");
    })();
  }, [router]);

  async function loginWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");

    const { error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    router.replace("/select-org");
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`;

    const { error } = await supabaseAuth.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Listo. Revisa tu correo para el link de acceso.");
  }

  async function sendPasswordReset() {
    setBusy(true);
    setMsg("");

    const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/reset-password`;

    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Te envié un correo para crear/restablecer tu contraseña.");
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Iniciar sesión</h1>

      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <button
          onClick={() => setMode("password")}
          disabled={busy}
          style={{ padding: 10, flex: 1, opacity: mode === "password" ? 1 : 0.6 }}
        >
          Con contraseña
        </button>
        <button
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
          />

          <button
            type="submit"
            disabled={busy}
            style={{ width: "100%", padding: 10, marginTop: 12 }}
          >
            {busy ? "Entrando..." : "Entrar"}
          </button>

          <button
            type="button"
            disabled={busy || !email}
            onClick={sendPasswordReset}
            style={{ width: "100%", padding: 10, marginTop: 10 }}
          >
            Crear / restablecer contraseña
          </button>
        </form>
      ) : (
        <form onSubmit={sendMagicLink}>
          <button
            type="submit"
            disabled={busy || !email}
            style={{ width: "100%", padding: 10, marginTop: 12 }}
          >
            {busy ? "Enviando..." : "Enviar magic link"}
          </button>
        </form>
      )}

      {msg && <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{msg}</p>}
    </main>
  );
}
