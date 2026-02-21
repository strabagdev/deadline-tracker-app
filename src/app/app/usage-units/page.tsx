"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type UsageUnit = { id: string; name: string; is_active: boolean; created_at: string };
type UsageField = {
  id: string;
  usage_unit_id: string;
  name: string;
  key: string;
  field_type: "text" | "number" | "date" | "boolean" | "select";
  options: unknown;
  created_at: string;
};
type FieldDraft = {
  name: string;
  key: string;
  field_type: UsageField["field_type"];
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

  const [units, setUnits] = useState<UsageUnit[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(() => units.find((u) => u.id === selectedId) ?? null, [units, selectedId]);

  const [fields, setFields] = useState<UsageField[]>([]);
  const [newUnitName, setNewUnitName] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<UsageField["field_type"]>("text");
  const [editingFieldId, setEditingFieldId] = useState<string>("");
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    void loadUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadFields(selectedId);
    else setFields([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function loadUnits() {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch("/api/usage-units", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar las unidades de uso");
      return;
    }
    const list = Array.isArray(json.usage_units) ? json.usage_units : [];
    setUnits(list);
    if (!selectedId && list.length) setSelectedId(list[0].id);
  }

  async function createUnit() {
    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const name = newUnitName.trim();
    if (!name) {
      setMsg("Nombre requerido");
      setBusy(false);
      return;
    }

    const res = await fetch("/api/usage-units", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo crear unidad");
      setBusy(false);
      return;
    }

    setNewUnitName("");
    await loadUnits();
    setBusy(false);
  }

  async function deleteUnit(unitId: string) {
    const ok = window.confirm("¿Eliminar esta unidad de uso?");
    if (!ok) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/usage-units?id=${encodeURIComponent(unitId)}&hard=1`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo eliminar la unidad");
      setBusy(false);
      return;
    }

    if (selectedId === unitId) setSelectedId("");
    await loadUnits();
    setBusy(false);
  }

  async function loadFields(usageUnitId: string) {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/usage-fields?usage_unit_id=${encodeURIComponent(usageUnitId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar campos");
      return;
    }
    setFields(Array.isArray(json.usage_fields) ? json.usage_fields : []);
  }

  async function createField() {
    if (!selectedId) {
      setMsg("Selecciona una unidad primero");
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

    const res = await fetch("/api/usage-fields", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        usage_unit_id: selectedId,
        name,
        field_type: newFieldType,
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
    await loadFields(selectedId);
    setBusy(false);
  }

  function startEditField(field: UsageField) {
    setEditingFieldId(field.id);
    setFieldDraft({
      name: field.name,
      key: field.key,
      field_type: field.field_type,
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

    const res = await fetch(`/api/usage-fields?id=${encodeURIComponent(editingFieldId)}`, {
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

  async function deleteField(fieldId: string) {
    const ok = window.confirm("¿Eliminar este campo de uso?");
    if (!ok) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/usage-fields?id=${encodeURIComponent(fieldId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo eliminar el campo");
      setBusy(false);
      return;
    }

    if (selectedId) await loadFields(selectedId);
    setBusy(false);
  }

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h2>Unidades de uso</h2>
      <p style={{ opacity: 0.75, marginTop: 6 }}>
        Define unidades (horas, km, ciclos, etc.) y sus campos personalizados.
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
          <h3 style={{ marginTop: 0 }}>Unidades</h3>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newUnitName}
              onChange={(e) => setNewUnitName(e.target.value)}
              placeholder="Ej: Horas"
              style={{ flex: 1, padding: 10 }}
              disabled={busy}
            />
            <button onClick={createUnit} disabled={busy} style={{ padding: "10px 12px" }}>
              Crear
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            {units.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Aún no hay unidades.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {units.map((u) => (
                  <li key={u.id} style={{ marginBottom: 8, display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <button
                      onClick={() => setSelectedId(u.id)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: 10,
                        border: "1px solid #eee",
                        background: u.id === selectedId ? "#f7f7f7" : "white",
                        cursor: "pointer",
                      }}
                    >
                      <strong>{u.name}</strong>
                    </button>
                    <button onClick={() => void deleteUnit(u.id)} disabled={busy} style={{ padding: "10px 12px" }}>
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div style={{ border: "1px solid #eee", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Campos de uso</h3>

          {!selected ? (
            <p style={{ opacity: 0.7 }}>Selecciona una unidad para ver/crear campos.</p>
          ) : (
            <>
              <div style={{ opacity: 0.8, marginBottom: 10 }}>
                Unidad seleccionada: <strong>{selected.name}</strong>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 180px 110px",
                  gap: 8,
                }}
              >
                <input
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="Ej: Operador"
                  style={{ padding: 10 }}
                  disabled={busy}
                />

                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as UsageField["field_type"])}
                  style={{ padding: 10 }}
                  disabled={busy}
                >
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="date">date</option>
                  <option value="boolean">boolean</option>
                  <option value="select">select</option>
                </select>

                <button onClick={createField} disabled={busy} style={{ padding: 10 }}>
                  Agregar
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                {fields.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>Esta unidad aún no tiene campos.</p>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Nombre</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Key</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tipo</th>
                        <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Acciones</th>
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
                          <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8, fontFamily: "monospace" }}>
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
                                    prev ? { ...prev, field_type: e.target.value as UsageField["field_type"] } : prev
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
                              <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={saveField} disabled={busy} style={{ padding: "6px 10px" }}>
                                  Guardar
                                </button>
                                <button onClick={cancelEditField} disabled={busy} style={{ padding: "6px 10px" }}>
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => startEditField(f)} disabled={busy} style={{ padding: "6px 10px" }}>
                                  Editar
                                </button>
                                <button onClick={() => void deleteField(f.id)} disabled={busy} style={{ padding: "6px 10px" }}>
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
