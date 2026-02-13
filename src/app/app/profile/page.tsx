"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function ProfilePage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");

    if (password.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("La confirmación de contraseña no coincide.");
      return;
    }

    setBusy(true);
    const { error: updateErr } = await supabaseAuth.auth.updateUser({ password });
    setBusy(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setMsg("Contraseña actualizada correctamente.");
  }

  return (
    <main style={{ maxWidth: 680, margin: "0 auto", padding: 16 }}>
      <h2>Perfil de usuario</h2>
      <p style={{ opacity: 0.8 }}>Cambia tu contraseña de acceso.</p>

      <form onSubmit={updatePassword} style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div>
          <label>Nueva contraseña</label>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            disabled={busy}
          />
        </div>

        <div>
          <label>Confirmar contraseña</label>
          <input
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            type="password"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            disabled={busy}
          />
        </div>

        {error && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</p>}
        {msg && <p style={{ color: "green", whiteSpace: "pre-wrap" }}>{msg}</p>}

        <div style={{ display: "flex", gap: 10 }}>
          <button type="submit" disabled={busy} style={{ padding: 10 }}>
            {busy ? "Guardando..." : "Actualizar contraseña"}
          </button>
          <button type="button" onClick={() => router.replace("/app")} style={{ padding: 10 }}>
            Volver
          </button>
        </div>
      </form>
    </main>
  );
}
