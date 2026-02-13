"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type StatusResponse = {
  has_super_admin?: boolean;
  is_super_admin?: boolean;
  email?: string | null;
  error?: string;
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [organizationName, setOrganizationName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");

  useEffect(() => {
    void validateAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function validateAccess() {
    setLoading(true);
    setError("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/super-admin/status", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = (await res.json().catch(() => ({}))) as StatusResponse;
    if (!res.ok) {
      setError(json.error || "No se pudo validar permisos.");
      setLoading(false);
      return;
    }

    if (!json.is_super_admin) {
      router.replace("/app");
      return;
    }

    setLoading(false);
  }

  async function createOrganization() {
    setBusy(true);
    setError("");
    setOk("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/admin/orgs/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        organizationName: organizationName.trim(),
        ownerEmail: ownerEmail.trim().toLowerCase(),
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      organization?: { id: string; name: string };
      owner?: { user_id: string; email: string };
    };

    if (!res.ok) {
      setError(json.error || "No se pudo crear organización.");
      setBusy(false);
      return;
    }

    setOk(
      `Organización creada: ${json.organization?.name || "(sin nombre)"}. Owner asignado: ${json.owner?.email || "(sin email)"}.`
    );
    setOrganizationName("");
    setOwnerEmail("");
    setBusy(false);
  }

  if (loading) return <p style={{ padding: 16 }}>Validando permisos...</p>;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h2>Super Admin</h2>
      <p style={{ opacity: 0.8 }}>
        Menu exclusivo para administracion global de plataforma.
      </p>

      {error && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</p>}
      {ok && <p style={{ color: "green", whiteSpace: "pre-wrap" }}>{ok}</p>}

      <section style={{ marginTop: 14, border: "1px solid #eee", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Crear organizacion y asignar owner</h3>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label>Nombre de organizacion</label>
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Acme Corp"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            />
          </div>

          <div>
            <label>Email del owner</label>
            <input
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@empresa.com"
              type="email"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            />
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
              El owner debe haber iniciado sesion al menos una vez para existir en profiles.
            </div>
          </div>

          <button onClick={createOrganization} disabled={busy} style={{ width: "100%", padding: 12 }}>
            {busy ? "Creando..." : "Crear organizacion"}
          </button>
        </div>
      </section>
    </main>
  );
}
