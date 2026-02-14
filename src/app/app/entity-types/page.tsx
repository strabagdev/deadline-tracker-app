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
  options: unknown;
  created_at: string;
};
type FieldDraft = {
  name: string;
  key: string;
  field_type: EntityField["field_type"];
  show_in_card: boolean;
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
  const [editingFieldId, setEditingFieldId] = useState<string>("");
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    void loadTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadFields(selectedId);
    else setFields([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
    setFields(Array.isArray(json.entity_fields) ? json.entity_fields : []);
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

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
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
          gridTemplateColumns: "360px 1fr",
          gap: 16,
          marginTop: 16,
        }}
      >
        <div style={{ border: "1px solid #eee", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Tipos</h3>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="Ej: Máquina"
              style={{ flex: 1, padding: 10 }}
              disabled={busy}
            />
            <button onClick={createType} disabled={busy} style={{ padding: "10px 12px" }}>
              Crear
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            {types.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Aún no hay tipos.</p>
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
            )}
          </div>
        </div>

        <div style={{ border: "1px solid #eee", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Campos del tipo</h3>

          {!selected ? (
            <p style={{ opacity: 0.7 }}>Selecciona un tipo para ver/crear campos.</p>
          ) : (
            <>
              <div style={{ opacity: 0.8, marginBottom: 10 }}>
                Tipo seleccionado: <strong>{selected.name}</strong>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 180px 140px 110px",
                  gap: 8,
                }}
              >
                <input
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="Ej: Patente"
                  style={{ padding: 10 }}
                  disabled={busy}
                />

                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as EntityField["field_type"])}
                  style={{ padding: 10 }}
                  disabled={busy}
                >
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="date">date</option>
                  <option value="boolean">boolean</option>
                  <option value="select">select</option>
                </select>

                <label style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 8 }}>
                  <input
                    type="checkbox"
                    checked={newShowInCard}
                    onChange={(e) => setNewShowInCard(e.target.checked)}
                    disabled={busy}
                  />
                  show_in_card
                </label>

                <button onClick={createField} disabled={busy} style={{ padding: 10 }}>
                  Agregar
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                {fields.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>Este tipo aún no tiene campos.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                          Nombre
                        </th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                          Key
                        </th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                          Tipo
                        </th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                          show_in_card
                        </th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                          Acciones
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((f) => (
                        <tr key={f.id}>
                          <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                            {editingFieldId === f.id ? (
                              <input
                                value={fieldDraft?.name ?? ""}
                                onChange={(e) =>
                                  setFieldDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                                }
                                style={{ width: "100%", padding: 8 }}
                                disabled={busy}
                              />
                            ) : (
                              f.name
                            )}
                          </td>
                          <td
                            style={{
                              borderBottom: "1px solid #f3f3f3",
                              padding: 8,
                              fontFamily: "monospace",
                            }}
                          >
                            {editingFieldId === f.id ? (
                              <input
                                value={fieldDraft?.key ?? ""}
                                onChange={(e) =>
                                  setFieldDraft((prev) => (prev ? { ...prev, key: e.target.value } : prev))
                                }
                                style={{ width: "100%", padding: 8, fontFamily: "monospace" }}
                                disabled={busy}
                              />
                            ) : (
                              f.key
                            )}
                          </td>
                          <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
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
                                style={{ padding: 8 }}
                                disabled={busy}
                              >
                                <option value="text">text</option>
                                <option value="number">number</option>
                                <option value="date">date</option>
                                <option value="boolean">boolean</option>
                                <option value="select">select</option>
                              </select>
                            ) : (
                              f.field_type
                            )}
                          </td>
                          <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
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
                              (f.show_in_card ? "true" : "false")
                            )}
                          </td>
                          <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                            {editingFieldId === f.id ? (
                              <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={saveField} disabled={busy} style={{ padding: "6px 10px" }}>
                                  Guardar
                                </button>
                                <button onClick={cancelEditField} disabled={busy} style={{ padding: "6px 10px" }}>
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEditField(f)}
                                disabled={busy}
                                style={{ padding: "6px 10px" }}
                              >
                                Editar
                              </button>
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
