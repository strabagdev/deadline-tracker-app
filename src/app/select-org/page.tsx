"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type Org = { id: string; name: string; role: string };

export default function SelectOrgPage() {
  const router = useRouter();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getTokenOrRedirect(): Promise<string | null> {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function init() {
    setLoading(true);
    setError("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/orgs", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "Error cargando organizaciones");
      setLoading(false);
      return;
    }

    const list: Org[] = Array.isArray(json.orgs) ? json.orgs : [];
    setOrgs(list);

    // ✅ Regla: 1 usuario = 1 org. Si hay 1, entramos automáticamente.
    if (list.length === 1) {
      const setRes = await fetch("/api/orgs/set-active", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ organizationId: list[0].id }),
      });

      if (setRes.ok) {
        router.replace("/app");
        return;
      }

      const setJson = await setRes.json().catch(() => ({}));
      setError(setJson.error || "No se pudo seleccionar la organización automáticamente");
      setLoading(false);
      return;
    }

    setLoading(false);
  }

  async function chooseOrg(orgId: string) {
    setBusy(true);
    setError("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/orgs/set-active", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationId: orgId }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudo seleccionar organización");
      setBusy(false);
      return;
    }

    router.replace("/app");
  }

  async function createOrg() {
    setBusy(true);
    setError("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const name = prompt("Nombre de la organización:");
    if (!name || name.trim().length < 2) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/orgs/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: name.trim() }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudo crear la organización");
      setBusy(false);
      return;
    }

    router.replace("/app");
  }

  if (loading) return <p style={{ padding: 16 }}>Cargando...</p>;

  return (
    <main style={{ padding: 16, maxWidth: 680, margin: "0 auto" }}>
      <h1>Acceso a organización</h1>

      {error && (
        <p style={{ color: "crimson", marginTop: 10, whiteSpace: "pre-wrap" }}>
          {error}
        </p>
      )}

      {orgs.length === 0 ? (
        <div style={{ marginTop: 14 }}>
          <p>No tienes acceso a ninguna organización en esta plataforma.</p>
          <p>Solicita invitación a un admin.</p>

          {/* Bootstrap (primer setup). Puedes quitar este botón cuando ya estés estable. */}
          <button
            onClick={createOrg}
            disabled={busy}
            style={{ padding: 12, marginTop: 12, width: "100%" }}
          >
            {busy ? "Creando..." : "Crear organización (bootstrap)"}
          </button>
        </div>
      ) : orgs.length > 1 ? (
        <div style={{ marginTop: 14 }}>
          <p style={{ color: "#b45309" }}>
            Atención: tu usuario aparece en más de 1 organización (no debería pasar).
            Elige una para continuar o avisa a soporte.
          </p>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 12 }}>
            {orgs.map((o) => (
              <li key={o.id} style={{ marginBottom: 10 }}>
                <button
                  onClick={() => chooseOrg(o.id)}
                  disabled={busy}
                  style={{ width: "100%", padding: 12, textAlign: "left" }}
                >
                  <strong>{o.name}</strong>
                  <div style={{ opacity: 0.7, fontSize: 13 }}>Rol: {o.role}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // Este caso normalmente no se ve (porque auto-redirigimos con 1 org),
        // pero lo dejamos por seguridad.
        <div style={{ marginTop: 14 }}>
          <p>Organización detectada. Entrando...</p>
        </div>
      )}
    </main>
  );
}
