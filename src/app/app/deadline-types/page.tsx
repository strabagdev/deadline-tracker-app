"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type DeadlineType = {
  id: string;
  name: string;
  measure_by: "date" | "usage";
  requires_document: boolean;
  is_active: boolean;
  created_at: string;
};

const MEASURE_BY_OPTIONS = [
  { value: "date", label: "Por fecha" },
  { value: "usage", label: "Por uso" },
] as const;

async function getTokenOrRedirect(router: any) {
  const { data } = await supabaseAuth.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    router.replace("/login");
    return null;
  }
  return token;
}

export default function DeadlineTypesPage() {
  const router = useRouter();

  const [items, setItems] = useState<DeadlineType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // create
  const [name, setName] = useState("");
  const [measureBy, setMeasureBy] = useState<"date" | "usage">("date");
  const [requiresDoc, setRequiresDoc] = useState(false);

  // edit row
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMeasureBy, setEditMeasureBy] = useState<"date" | "usage">("date");
  const [editRequiresDoc, setEditRequiresDoc] = useState(false);
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

    const res = await fetch("/api/deadline-types", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar los tipos");
      setItems([]);
      setLoading(false);
      return;
    }

    setItems(json.deadline_types ?? []);
    setLoading(false);
  }

  function startEdit(row: DeadlineType) {
    setEditingId(row.id);
    setEditName(row.name);
    setEditMeasureBy(row.measure_by);
    setEditRequiresDoc(row.requires_document);
    setEditIsActive(row.is_active);
    setMsg("");
  }

  function cancelEdit() {
    setEditingId(null);
    setMsg("");
  }

  async function create() {
    if (!canCreate) return;

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch("/api/deadline-types", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: name.trim(),
        measure_by: measureBy,
        requires_document: requiresDoc,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo crear");
      setBusy(false);
      return;
    }

    setName("");
    setMeasureBy("date");
    setRequiresDoc(false);

    await refresh();
    setBusy(false);
  }

  async function saveEdit() {
    if (!editingId) return;

    if (editName.trim() === "") {
      setMsg("El nombre no puede estar vacío");
      return;
    }

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/deadline-types?id=${encodeURIComponent(editingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: editName.trim(),
        measure_by: editMeasureBy,
        requires_document: editRequiresDoc,
        is_active: editIsActive,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo guardar");
      setBusy(false);
      return;
    }

    setEditingId(null);
    await refresh();
    setBusy(false);
  }

  async function deactivate(id: string) {
    const ok = window.confirm(
      "¿Desactivar este tipo? No se borrará, pero no aparecerá como opción activa."
    );
    if (!ok) return;

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/deadline-types?id=${encodeURIComponent(id)}`, {
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

  const cardStyle: React.CSSProperties = {
    border: "1px solid #eee",
    borderRadius: 14,
    padding: 14,
    background: "white",
  };

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Tipos de vencimiento</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>
            Catálogo por organización. Los vencimientos se crean siempre a partir de un tipo.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={refresh} style={{ padding: 10 }} disabled={busy}>
            Refrescar
          </button>
        </div>
      </div>

      {msg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{msg}</p>}

      <section style={{ marginTop: 14, ...cardStyle }}>
        <h3 style={{ marginTop: 0 }}>Crear tipo</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 220px", gap: 12 }}>
          <div>
            <label>Nombre</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Certificado de gases"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            />
          </div>

          <div>
            <label>Medición</label>
            <select
              value={measureBy}
              onChange={(e) => setMeasureBy(e.target.value as any)}
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            >
              {MEASURE_BY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={requiresDoc}
                onChange={(e) => setRequiresDoc(e.target.checked)}
                disabled={busy}
              />
              Requiere documento
            </label>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={create} style={{ padding: 10, fontWeight: 700 }} disabled={busy || !canCreate}>
            {busy ? "Creando..." : "Crear"}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        <h3 style={{ marginTop: 0 }}>Listado</h3>

        {loading ? (
          <p>Cargando...</p>
        ) : items.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Aún no hay tipos creados.</p>
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
                          {!row.is_active && (
                            <span style={{ fontSize: 12, padding: "2px 8px", border: "1px solid #ddd", borderRadius: 999, opacity: 0.8 }}>
                              inactivo
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                          {row.measure_by === "date" ? "por fecha" : "por uso"} ·{" "}
                          {row.requires_document ? "requiere doc" : "sin doc"} ·{" "}
                          {new Date(row.created_at).toLocaleString()}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => startEdit(row)} style={{ padding: 10 }} disabled={busy}>
                          Editar
                        </button>
                        {row.is_active && (
                          <button onClick={() => deactivate(row.id)} style={{ padding: 10 }} disabled={busy}>
                            Desactivar
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <h4 style={{ marginTop: 0 }}>Editar</h4>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 220px", gap: 12 }}>
                        <div>
                          <label>Nombre</label>
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            style={{ width: "100%", padding: 10, marginTop: 6 }}
                            disabled={busy}
                          />
                        </div>

                        <div>
                          <label>Medición</label>
                          <select
                            value={editMeasureBy}
                            onChange={(e) => setEditMeasureBy(e.target.value as any)}
                            style={{ width: "100%", padding: 10, marginTop: 6 }}
                            disabled={busy}
                          >
                            {MEASURE_BY_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div style={{ display: "grid", gap: 8 }}>
                          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 2 }}>
                            <input
                              type="checkbox"
                              checked={editRequiresDoc}
                              onChange={(e) => setEditRequiresDoc(e.target.checked)}
                              disabled={busy}
                            />
                            Requiere documento
                          </label>

                          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={editIsActive}
                              onChange={(e) => setEditIsActive(e.target.checked)}
                              disabled={busy}
                            />
                            Activo
                          </label>
                        </div>
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
