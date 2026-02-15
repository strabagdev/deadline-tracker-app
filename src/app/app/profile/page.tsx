"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function ProfilePage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgRole, setOrgRole] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState("");
  const [logoError, setLogoError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (!cancelled) {
          setOrgLoading(false);
        }
        return;
      }

      const res = await fetch("/api/orgs/branding", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));

      if (cancelled) return;
      setOrgRole(json?.role ?? null);
      setOrgName(json?.organization?.name ?? "");
      setLogoUrl(json?.organization?.logo_url ?? "");
      setOrgLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function getAuthToken() {
    const { data } = await supabaseAuth.auth.getSession();
    return data.session?.access_token ?? null;
  }

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

  async function uploadLogo(e: React.FormEvent) {
    e.preventDefault();
    setLogoError("");
    setLogoMsg("");

    if (!logoFile) {
      setLogoError("Selecciona una imagen.");
      return;
    }

    const token = await getAuthToken();
    if (!token) {
      setLogoError("Sesión inválida.");
      return;
    }

    setLogoBusy(true);
    const form = new FormData();
    form.append("file", logoFile);

    const res = await fetch("/api/orgs/branding", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    setLogoBusy(false);

    if (!res.ok) {
      setLogoError(json?.error ?? "No se pudo subir el logo.");
      return;
    }

    setLogoUrl(json?.organization?.logo_url ?? "");
    setLogoFile(null);
    setLogoMsg("Logo actualizado.");
  }

  async function removeLogo() {
    setLogoError("");
    setLogoMsg("");

    const token = await getAuthToken();
    if (!token) {
      setLogoError("Sesión inválida.");
      return;
    }

    setLogoBusy(true);
    const res = await fetch("/api/orgs/branding", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    setLogoBusy(false);

    if (!res.ok) {
      setLogoError(json?.error ?? "No se pudo eliminar el logo.");
      return;
    }

    setLogoUrl("");
    setLogoFile(null);
    setLogoMsg("Logo eliminado.");
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

      <section style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 18 }}>
        <h3 style={{ margin: 0 }}>Marca de organización</h3>
        <p style={{ marginTop: 8, opacity: 0.8 }}>
          {orgLoading
            ? "Cargando organización..."
            : orgName
              ? `Organización activa: ${orgName}`
              : "No hay organización activa."}
        </p>

        {!orgLoading && orgRole !== "owner" ? (
          <p style={{ fontSize: 13, opacity: 0.75 }}>
            Solo el owner de la organización puede subir o eliminar el logo.
          </p>
        ) : null}

        {!orgLoading && orgRole === "owner" ? (
          <form onSubmit={uploadLogo} style={{ display: "grid", gap: 10 }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo actual de la organización"
                width={72}
                height={72}
                style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 10, border: "1px solid #ddd" }}
              />
            ) : (
              <div style={{ fontSize: 13, opacity: 0.7 }}>No hay logo configurado.</div>
            )}

            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              disabled={logoBusy}
            />

            {logoError && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{logoError}</p>}
            {logoMsg && <p style={{ color: "green", whiteSpace: "pre-wrap" }}>{logoMsg}</p>}

            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" disabled={logoBusy || !logoFile} style={{ padding: 10 }}>
                {logoBusy ? "Subiendo..." : "Guardar logo"}
              </button>
              <button type="button" onClick={removeLogo} disabled={logoBusy || !logoUrl} style={{ padding: 10 }}>
                {logoBusy ? "Procesando..." : "Eliminar logo"}
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}
