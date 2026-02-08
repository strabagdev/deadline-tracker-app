"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function setNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");

    const { error } = await supabaseAuth.auth.updateUser({ password });

    setBusy(false);

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg("Contraseña actualizada. Redirigiendo...");
    router.replace("/select-org");
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Definir nueva contraseña</h1>
      <form onSubmit={setNewPassword}>
        <label>Nueva contraseña</label>
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: 10, marginTop: 6 }}
          type="password"
          required
        />
        <button
          type="submit"
          disabled={busy}
          style={{ width: "100%", padding: 10, marginTop: 12 }}
        >
          {busy ? "Guardando..." : "Guardar"}
        </button>
      </form>

      {msg && <p style={{ marginTop: 12 }}>{msg}</p>}
    </main>
  );
}
