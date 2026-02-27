"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type EntityType = { id: string; name: string; icon: string | null };
type EntityField = {
  id: string;
  entity_type_id: string;
  name: string;
  key: string;
  field_type: "text" | "number" | "date" | "boolean" | "select";
  show_in_card: boolean;
  analytics_mode: "none" | "distribution" | "trend" | "count";
  options: unknown;
  created_at: string;
};
type FieldDraft = {
  name: string;
  key: string;
  field_type: EntityField["field_type"];
  show_in_card: boolean;
  analytics_mode: EntityField["analytics_mode"];
};

function normalizeAnalyticsMode(value: unknown): EntityField["analytics_mode"] {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "distribution" || raw === "trend" || raw === "count") return raw;
  return "none";
}

async function getTokenOrRedirect(router: { replace: (href: string) => void }) {
  const { data } = await supabaseAuth.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    router.replace("/login");
    return null;
  }
  return token;
}

export default function EntityTypesPage() {
  const router = useRouter();

  const [types, setTypes] = useState<EntityType[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  const selected = useMemo(
    () => types.find((t) => t.id === selectedId) ?? null,
    [types, selectedId]
  );

  const [fields, setFields] = useState<EntityField[]>([]);

  const [newTypeName, setNewTypeName] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<EntityField["field_type"]>("text");
  const [newShowInCard, setNewShowInCard] = useState(false);
  const [newAnalyticsMode, setNewAnalyticsMode] = useState<EntityField["analytics_mode"]>("none");
  const [editingFieldId, setEditingFieldId] = useState<string>("");
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");
  const [isMobile, setIsMobile] = useState(false);
  const controlStyle: React.CSSProperties = {
    width: "100%",
    minWidth: 0,
    padding: "10px 12px",
    border: "1px solid #d9e0ea",
    borderRadius: 10,
    background: "#fff",
    fontSize: 14,
  };
  const thStyle: React.CSSProperties = {
    textAlign: "left",
    borderBottom: "1px solid #dbe4ef",
    padding: "10px 8px",
    fontSize: 12,
    fontWeight: 700,
    color: "#41526b",
    background: "#f6f9fc",
    whiteSpace: "nowrap",
  };
  const tdStyle: React.CSSProperties = {
    borderBottom: "1px solid #edf2f7",
    padding: "10px 8px",
    verticalAlign: "top",
    fontSize: 14,
    color: "#0f172a",
  };

  useEffect(() => {
    void loadTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadFields(selectedId);
    else setFields([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth < 768);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  async function loadTypes() {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch("/api/entity-types", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar tipos");
      return;
    }
    const list = Array.isArray(json.entity_types) ? json.entity_types : [];
    setTypes(list);
    if (!selectedId && list.length) setSelectedId(list[0].id);
  }

  async function createType() {
    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const name = newTypeName.trim();
    if (!name) {
      setMsg("Nombre requerido");
      setBusy(false);
      return;
    }

    const res = await fetch("/api/entity-types", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo crear tipo");
      setBusy(false);
      return;
    }

    setNewTypeName("");
    await loadTypes();
    setBusy(false);
  }

  async function loadFields(entityTypeId: string) {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(
      `/api/entity-fields?entity_type_id=${encodeURIComponent(entityTypeId)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar campos");
      return;
    }
    const list = Array.isArray(json.entity_fields) ? (json.entity_fields as EntityField[]) : [];
    setFields(
      list.map((field) => ({
        ...field,
        analytics_mode: normalizeAnalyticsMode(field.analytics_mode),
      }))
    );
  }

  async function createField() {
    if (!selectedId) {
      setMsg("Selecciona un tipo primero");
      return;
    }

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const name = newFieldName.trim();
    if (!name) {
      setMsg("Nombre de campo requerido");
      setBusy(false);
      return;
    }

    const res = await fetch("/api/entity-fields", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        entity_type_id: selectedId,
        name,
        field_type: newFieldType,
        show_in_card: newShowInCard,
        analytics_mode: newAnalyticsMode,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo crear campo");
      setBusy(false);
      return;
    }

    setNewFieldName("");
    setNewFieldType("text");
    setNewShowInCard(false);
    setNewAnalyticsMode("none");
    await loadFields(selectedId);
    setBusy(false);
  }

  function startEditField(field: EntityField) {
    setEditingFieldId(field.id);
    setFieldDraft({
      name: field.name,
      key: field.key,
      field_type: field.field_type,
      show_in_card: field.show_in_card,
      analytics_mode: normalizeAnalyticsMode(field.analytics_mode),
    });
  }

  function cancelEditField() {
    setEditingFieldId("");
    setFieldDraft(null);
  }

  async function saveField() {
    if (!editingFieldId || !fieldDraft) return;

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/entity-fields?id=${encodeURIComponent(editingFieldId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(fieldDraft),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo actualizar el campo");
      setBusy(false);
      return;
    }

    cancelEditField();
    if (selectedId) await loadFields(selectedId);
    setBusy(false);
  }

  async function deleteField(fieldId: string, fieldName: string) {
    const ok = confirm(`¿Eliminar campo "${fieldName}"? Esta acción no se puede deshacer.`);
    if (!ok) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/entity-fields?id=${encodeURIComponent(fieldId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo eliminar el campo");
      setBusy(false);
      return;
    }

    if (editingFieldId === fieldId) cancelEditField();
    if (selectedId) await loadFields(selectedId);
    setBusy(false);
  }

  return (
    <main style={{ padding: 12, maxWidth: 1100, margin: "0 auto" }}>
      <h2>Tipos de entidad</h2>
      <p style={{ opacity: 0.75, marginTop: 6 }}>
        Define tipos (Máquina, Persona, etc.) y sus campos personalizados.
      </p>

      {msg && (
        <p
          style={{
            marginTop: 10,
            color: msg.toLowerCase().includes("no ") ? "crimson" : "inherit",
          }}
        >
          {msg}
        </p>
      )}

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
          marginTop: 16,
        }}
      >
        <div style={{ border: "1px solid #eee", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Tipos</h3>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="Ej: Máquina"
              style={{ flex: "1 1 220px", minWidth: 0, padding: 10 }}
              disabled={busy}
            />
            <button onClick={createType} disabled={busy} style={{ padding: "10px 12px", flex: "0 0 auto" }}>
              Crear
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            {types.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Aún no hay tipos.</p>
            ) : (
              isMobile ? (
                <select
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                  style={{ width: "100%", padding: 10 }}
                  disabled={busy}
                >
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {types.map((t) => (
                    <li key={t.id} style={{ marginBottom: 8 }}>
                      <button
                        onClick={() => setSelectedId(t.id)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          padding: 10,
                          border: "1px solid #eee",
                          background: t.id === selectedId ? "#f7f7f7" : "white",
                          cursor: "pointer",
                        }}
                      >
                        <strong>{t.name}</strong>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>

        <div style={{ border: "1px solid #eee", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Campos del tipo</h3>

          {!selected ? (
            <p style={{ opacity: 0.7 }}>Selecciona un tipo para ver/crear campos.</p>
          ) : (
            <>
              <div
                style={{
                  marginBottom: 12,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  border: "1px solid #dbe4ef",
                  background: "#f8fbff",
                  borderRadius: 999,
                  padding: "6px 10px",
                  fontSize: 13,
                }}
              >
                <span style={{ opacity: 0.75 }}>Tipo seleccionado</span>
                <strong>{selected.name}</strong>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                  gap: 10,
                  border: "1px solid #e6edf5",
                  background: "linear-gradient(180deg, #fbfdff 0%, #f6f9fc 100%)",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: "#4f5d75" }}>Nombre del campo</div>
                  <input
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder="Ej: Patente"
                    style={controlStyle}
                    disabled={busy}
                  />
                </div>

                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: "#4f5d75" }}>Tipo de dato</div>
                  <select
                    value={newFieldType}
                    onChange={(e) => setNewFieldType(e.target.value as EntityField["field_type"])}
                    style={controlStyle}
                    disabled={busy}
                  >
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="date">date</option>
                    <option value="boolean">boolean</option>
                    <option value="select">select</option>
                  </select>
                </div>

                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: "#4f5d75" }}>Mostrar en tarjeta</div>
                  <label
                    style={{
                      ...controlStyle,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      cursor: "pointer",
                      userSelect: "none",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={newShowInCard}
                      onChange={(e) => setNewShowInCard(e.target.checked)}
                      disabled={busy}
                    />
                    show_in_card
                  </label>
                </div>

                <div>
                  <div style={{ fontSize: 12, marginBottom: 6, color: "#4f5d75" }}>Modo analítico</div>
                  <select
                    value={newAnalyticsMode}
                    onChange={(e) => setNewAnalyticsMode(e.target.value as EntityField["analytics_mode"])}
                    style={controlStyle}
                    disabled={busy}
                  >
                    <option value="none">analytics: none</option>
                    <option value="distribution">analytics: distribution</option>
                    <option value="trend">analytics: trend</option>
                    <option value="count">analytics: count</option>
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    onClick={createField}
                    disabled={busy}
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid #1d4ed8",
                      background: "#2563eb",
                      color: "white",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Agregar campo
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 12, overflowX: "auto" }}>
                {fields.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>Este tipo aún no tiene campos.</p>
                ) : (
                  <table style={{ width: "100%", minWidth: 760, borderCollapse: "separate", borderSpacing: 0 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Nombre</th>
                        <th style={thStyle}>Key</th>
                        <th style={thStyle}>Tipo</th>
                        <th style={thStyle}>show_in_card</th>
                        <th style={thStyle}>analytics_mode</th>
                        <th style={thStyle}>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f, idx) => (
                        <tr key={f.id} style={{ background: idx % 2 === 0 ? "#ffffff" : "#fbfdff" }}>
                          <td style={tdStyle}>
                            {editingFieldId === f.id ? (
                              <input
                                value={fieldDraft?.name ?? ""}
                                onChange={(e) =>
                                  setFieldDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                                }
                                style={controlStyle}
                                disabled={busy}
                              />
                            ) : (
                              <strong>{f.name}</strong>
                            )}
                          </td>
                          <td
                            style={{
                              ...tdStyle,
                              fontFamily: "monospace",
                            }}
                          >
                            {editingFieldId === f.id ? (
                              <input
                                value={fieldDraft?.key ?? ""}
                                onChange={(e) =>
                                  setFieldDraft((prev) => (prev ? { ...prev, key: e.target.value } : prev))
                                }
                                style={{ ...controlStyle, fontFamily: "monospace" }}
                                disabled={busy}
                              />
                            ) : (
                              f.key
                            )}
                          </td>
                          <td style={tdStyle}>
                            {editingFieldId === f.id ? (
                              <select
                                value={fieldDraft?.field_type ?? "text"}
                                onChange={(e) =>
                                  setFieldDraft((prev) =>
                                    prev
                                      ? { ...prev, field_type: e.target.value as EntityField["field_type"] }
                                      : prev
                                  )
                                }
                                style={controlStyle}
                                disabled={busy}
                              >
                                <option value="text">text</option>
                                <option value="number">number</option>
                                <option value="date">date</option>
                                <option value="boolean">boolean</option>
                                <option value="select">select</option>
                              </select>
                            ) : (
                              <span
                                style={{
                                  display: "inline-block",
                                  border: "1px solid #dbe4ef",
                                  background: "#f8fbff",
                                  borderRadius: 999,
                                  padding: "3px 8px",
                                  fontSize: 12,
                                }}
                              >
                                {f.field_type}
                              </span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {editingFieldId === f.id ? (
                              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(fieldDraft?.show_in_card)}
                                  onChange={(e) =>
                                    setFieldDraft((prev) =>
                                      prev ? { ...prev, show_in_card: e.target.checked } : prev
                                    )
                                  }
                                  disabled={busy}
                                />
                                true
                              </label>
                            ) : (
                              <span
                                style={{
                                  display: "inline-block",
                                  borderRadius: 999,
                                  padding: "3px 8px",
                                  fontSize: 12,
                                  border: `1px solid ${f.show_in_card ? "#86efac" : "#e2e8f0"}`,
                                  background: f.show_in_card ? "#f0fdf4" : "#f8fafc",
                                  color: f.show_in_card ? "#166534" : "#475569",
                                }}
                              >
                                {f.show_in_card ? "true" : "false"}
                              </span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {editingFieldId === f.id ? (
                              <select
                                value={fieldDraft?.analytics_mode ?? "none"}
                                onChange={(e) =>
                                  setFieldDraft((prev) =>
                                    prev
                                      ? { ...prev, analytics_mode: e.target.value as EntityField["analytics_mode"] }
                                      : prev
                                  )
                                }
                                style={controlStyle}
                                disabled={busy}
                              >
                                <option value="none">none</option>
                                <option value="distribution">distribution</option>
                                <option value="trend">trend</option>
                                <option value="count">count</option>
                              </select>
                            ) : (
                              <span
                                style={{
                                  display: "inline-block",
                                  borderRadius: 999,
                                  padding: "3px 8px",
                                  fontSize: 12,
                                  border: "1px solid #bfdbfe",
                                  background: "#eff6ff",
                                  color: "#1d4ed8",
                                }}
                              >
                                {f.analytics_mode ?? "none"}
                              </span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {editingFieldId === f.id ? (
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={saveField}
                                  disabled={busy}
                                  style={{
                                    padding: "7px 10px",
                                    borderRadius: 8,
                                    border: "1px solid #1d4ed8",
                                    background: "#2563eb",
                                    color: "white",
                                    fontWeight: 600,
                                  }}
                                >
                                  Guardar
                                </button>
                                <button
                                  onClick={cancelEditField}
                                  disabled={busy}
                                  style={{
                                    padding: "7px 10px",
                                    borderRadius: 8,
                                    border: "1px solid #cbd5e1",
                                    background: "white",
                                    color: "#334155",
                                  }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  onClick={() => startEditField(f)}
                                  disabled={busy}
                                  style={{
                                    padding: "7px 10px",
                                    borderRadius: 8,
                                    border: "1px solid #cbd5e1",
                                    background: "white",
                                  }}
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => void deleteField(f.id, f.name)}
                                  disabled={busy}
                                  style={{
                                    padding: "7px 10px",
                                    borderRadius: 8,
                                    border: "1px solid #fecaca",
                                    background: "#fff1f2",
                                    color: "#be123c",
                                  }}
                                >
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
