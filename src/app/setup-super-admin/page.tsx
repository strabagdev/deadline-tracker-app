"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader } from "@/components/ui/loader";

type PublicStatusResponse = {
  has_super_admin?: boolean;
  configured_super_admin_email?: string | null;
  error?: string;
};

type SetupAuthMode = "associate-existing" | "create-new";

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
  const [authMode, setAuthMode] = useState<SetupAuthMode>("associate-existing");
  const [configuredEmail, setConfiguredEmail] = useState("");

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const missingChecks: string[] = [];
  if (!normalizedEmail) missingChecks.push("Email requerido");
  if (authMode === "create-new" && password.length < 8) missingChecks.push("Contraseña mínimo 8 caracteres");
  if (authMode === "create-new" && confirmPassword !== password) missingChecks.push("Confirmación de contraseña no coincide");
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
      setLoading(false);
      router.replace("/login");
      return;
    }

    const nextConfiguredEmail = String(json.configured_super_admin_email ?? "").trim().toLowerCase();
    setConfiguredEmail(nextConfiguredEmail);
    if (nextConfiguredEmail) {
      setEmail(nextConfiguredEmail);
      setAuthMode("create-new");
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
        authMode,
        email: normalizedEmail,
        password: authMode === "create-new" ? password : "",
        setupKey: setupKey.trim(),
      }),
    });

    const json = (await res.json().catch(() => ({}))) as { error?: string; email?: string; auth_mode?: SetupAuthMode };
    if (!res.ok) {
      setError(json.error || "No se pudo crear el super admin inicial.");
      setBusy(false);
      return;
    }

    setOk(
      json.auth_mode === "associate-existing"
        ? `Super admin asociado: ${json.email || normalizedEmail}. La contraseña del usuario existente no fue modificada.`
        : `Super admin creado: ${json.email || normalizedEmail}. Ahora inicia sesión.`
    );
    setBusy(false);
    setTimeout(() => router.replace("/login"), 900);
  }

  if (loading) {
    return (
      <main style={{ minHeight: "100vh", padding: 16, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader label="Validando setup inicial..." />
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 680, margin: "40px auto", padding: 16 }}>
      <h1>Preconfiguración de Plataforma</h1>
      <p style={{ opacity: 0.8 }}>
        Esta instalación no tiene super admin. Define aquí el acceso inicial. Esta pantalla
        desaparecerá una vez creado.
      </p>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div>
          <label>Modo</label>
          <div style={{ display: "grid", gap: 8, marginTop: 6 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={authMode === "associate-existing"}
                onChange={() => setAuthMode("associate-existing")}
                disabled={busy}
              />
              Asociar usuario existente del Auth central
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="radio"
                checked={authMode === "create-new"}
                onChange={() => setAuthMode("create-new")}
                disabled={busy}
              />
              Crear usuario nuevo en Auth
            </label>
          </div>
        </div>

        <div>
          <label>Email super admin</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="superadmin@empresa.com"
            style={{ width: "100%", padding: 10, marginTop: 6 }}
            disabled={busy}
            readOnly={Boolean(configuredEmail)}
          />
          {configuredEmail ? (
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              Este email viene de <code>PLATFORM_SUPER_ADMIN_EMAIL</code>.
            </div>
          ) : null}
        </div>

        {authMode === "create-new" ? (
          <>
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
          </>
        ) : (
          <div style={{ fontSize: 13, opacity: 0.8 }}>
            Se reutilizará un usuario ya existente en el Auth central. Si no recuerdas su contraseña, luego puedes usar
            magic link o recuperación.
          </div>
        )}

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
