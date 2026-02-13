"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PublicStatusResponse = {
  has_super_admin?: boolean;
  error?: string;
};

export default function SetupSuperAdminPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const missingChecks: string[] = [];
  if (!normalizedEmail) missingChecks.push("Email requerido");
  if (password.length < 8) missingChecks.push("Contraseña mínimo 8 caracteres");
  if (confirmPassword !== password) missingChecks.push("Confirmación de contraseña no coincide");
  if (!setupKey.trim()) missingChecks.push("Clave de setup requerida");
  const canSubmit = missingChecks.length === 0;

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError("");

    const res = await fetch("/api/platform/super-admin/public-status");
    const json = (await res.json().catch(() => ({}))) as PublicStatusResponse;

    if (!res.ok) {
      setError(json.error || "No se pudo validar estado de plataforma");
      setLoading(false);
      return;
    }

    if (json.has_super_admin) {
      router.replace("/login");
      return;
    }

    setLoading(false);
  }

  async function createSuperAdmin() {
    if (!canSubmit) {
      setError("Completa todos los campos correctamente.");
      return;
    }

    setBusy(true);
    setError("");
    setOk("");

    const res = await fetch("/api/platform/super-admin/initialize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: normalizedEmail,
        password,
        setupKey: setupKey.trim(),
      }),
    });

    const json = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
    if (!res.ok) {
      setError(json.error || "No se pudo crear el super admin inicial.");
      setBusy(false);
      return;
    }

    setOk(`Super admin creado: ${json.email || normalizedEmail}. Ahora inicia sesión.`);
    setBusy(false);
    setTimeout(() => router.replace("/login"), 900);
  }

  if (loading) return <p style={{ padding: 16 }}>Validando setup inicial...</p>;

  return (
    <main style={{ maxWidth: 680, margin: "40px auto", padding: 16 }}>
      <h1>Preconfiguración de Plataforma</h1>
      <p style={{ opacity: 0.8 }}>
        Esta instalación no tiene super admin. Crea aquí el superusuario inicial. Esta pantalla
        desaparecerá una vez creado.
      </p>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div>
          <label>Email super admin</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="superadmin@empresa.com"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            disabled={busy}
          />
        </div>

        <div>
          <label>Contraseña (mínimo 8)</label>
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

        <div>
          <label>Clave de setup</label>
          <input
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
            type="password"
            placeholder="PLATFORM_SETUP_KEY"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            disabled={busy}
          />
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Define esta clave en el servidor como <code>PLATFORM_SETUP_KEY</code>.
          </div>
        </div>
      </div>

      {error && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</p>}
      {ok && <p style={{ color: "green", whiteSpace: "pre-wrap" }}>{ok}</p>}
      {!canSubmit && (
        <p style={{ color: "#8a6d3b", whiteSpace: "pre-wrap" }}>
          Falta completar:
          {" "}{missingChecks.join(" · ")}
        </p>
      )}

      <button
        onClick={createSuperAdmin}
        disabled={busy}
        style={{ padding: 12, width: "100%", marginTop: 12 }}
      >
        {busy ? "Creando super admin..." : "Crear super admin inicial"}
      </button>
    </main>
  );
}
