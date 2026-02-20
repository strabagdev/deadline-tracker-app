"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";

type UsageUnit = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

async function getTokenOrRedirect(router: { replace: (href: string) => void }) {
  const { data } = await supabaseAuth.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    router.replace("/login");
    return null;
  }
  return token;
}

export default function UsageUnitsPage() {
  const router = useRouter();
  const [items, setItems] = useState<UsageUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const canCreate = useMemo(() => name.trim().length > 0, [name]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setLoading(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch("/api/usage-units", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar las unidades");
      setItems([]);
      setLoading(false);
      return;
    }

    setItems(json.usage_units ?? []);
    setLoading(false);
  }

  function startEdit(row: UsageUnit) {
    setEditingId(row.id);
    setEditName(row.name);
    setEditIsActive(row.is_active);
    setMsg("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditIsActive(true);
    setMsg("");
  }

  async function create() {
    if (!canCreate) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch("/api/usage-units", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: name.trim() }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo crear la unidad");
      setBusy(false);
      return;
    }

    setName("");
    await refresh();
    setBusy(false);
  }

  async function saveEdit() {
    if (!editingId) return;
    if (!editName.trim()) {
      setMsg("El nombre no puede estar vacío");
      return;
    }

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/usage-units?id=${encodeURIComponent(editingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: editName.trim(),
        is_active: editIsActive,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo guardar");
      setBusy(false);
      return;
    }

    cancelEdit();
    await refresh();
    setBusy(false);
  }

  async function deactivate(id: string) {
    const ok = window.confirm("¿Desactivar esta unidad? Dejará de aparecer como opción en vencimientos por uso.");
    if (!ok) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/usage-units?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo desactivar");
      setBusy(false);
      return;
    }
    await refresh();
    setBusy(false);
  }

  async function remove(id: string) {
    const ok = window.confirm("¿Eliminar esta unidad de uso de forma permanente?");
    if (!ok) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/usage-units?id=${encodeURIComponent(id)}&hard=1`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo eliminar");
      setBusy(false);
      return;
    }
    await refresh();
    setBusy(false);
  }

  const cardStyle: React.CSSProperties = {
    border: "1px solid #eee",
    borderRadius: 14,
    padding: 14,
    background: "white",
  };

  return (
    <main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Unidades de uso</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>
            Catálogo por organización para vencimientos medidos por uso.
          </p>
        </div>
        <button onClick={refresh} style={{ padding: 10 }} disabled={busy}>
          Refrescar
        </button>
      </div>

      {msg ? <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{msg}</p> : null}

      <section style={{ marginTop: 14, ...cardStyle }}>
        <h3 style={{ marginTop: 0 }}>Crear unidad</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: horas"
            style={{ width: "100%", padding: 10 }}
            disabled={busy}
          />
          <button onClick={create} style={{ padding: "10px 12px", fontWeight: 700 }} disabled={busy || !canCreate}>
            {busy ? "Creando..." : "Crear"}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Listado</h3>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "12px 0" }}>
            <Loader label="Cargando unidades..." />
          </div>
        ) : items.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Aún no hay unidades creadas.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {items.map((row) => {
              const isEditing = editingId === row.id;
              return (
                <div key={row.id} style={cardStyle}>
                  {!isEditing ? (
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <div>
                        <div style={{ fontWeight: 800, display: "flex", gap: 10, alignItems: "center" }}>
                          <span>{row.name}</span>
                          {!row.is_active ? (
                            <span style={{ fontSize: 12, padding: "2px 8px", border: "1px solid #ddd", borderRadius: 999, opacity: 0.8 }}>
                              inactiva
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                          {new Date(row.created_at).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => startEdit(row)} style={{ padding: 10 }} disabled={busy}>
                          Editar
                        </button>
                        {row.is_active ? (
                          <button onClick={() => deactivate(row.id)} style={{ padding: 10 }} disabled={busy}>
                            Desactivar
                          </button>
                        ) : null}
                        <button onClick={() => void remove(row.id)} style={{ padding: 10 }} disabled={busy}>
                          Eliminar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h4 style={{ marginTop: 0 }}>Editar unidad</h4>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          style={{ width: "100%", padding: 10 }}
                          disabled={busy}
                        />
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={editIsActive}
                            onChange={(e) => setEditIsActive(e.target.checked)}
                            disabled={busy}
                          />
                          Activa
                        </label>
                      </div>
                      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        <button onClick={cancelEdit} style={{ padding: 10 }} disabled={busy}>
                          Cancelar
                        </button>
                        <button onClick={saveEdit} style={{ padding: 10, fontWeight: 700 }} disabled={busy}>
                          {busy ? "Guardando..." : "Guardar"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
