"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type EntityType = { id: string; name: string; icon: string | null; created_at: string };
type EntityRow = {
  id: string;
  name: string;
  entity_type_id: string;
  entity_type_name: string;
  tracks_usage: boolean;
  created_at: string;
};

type EntityField = {
  id: string;
  name: string;
  key: string;
  field_type: "text" | "number" | "date" | "boolean" | "select";
  show_in_card: boolean;
  options: any;
  created_at: string;
};

async function getTokenOrRedirect(router: any) {
  const { data } = await supabaseAuth.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    router.replace("/login");
    return null;
  }
  return token;
}

export default function EntitiesPage() {
  const router = useRouter();

  const [types, setTypes] = useState<EntityType[]>([]);
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTypeId, setNewTypeId] = useState("");
  const [newTracksUsage, setNewTracksUsage] = useState(false);

  const [typeFields, setTypeFields] = useState<EntityField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const selectedType = useMemo(
    () => types.find((t) => t.id === newTypeId) ?? null,
    [types, newTypeId]
  );

  useEffect(() => {
    void loadTypesAndEntities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!newTypeId) {
      setTypeFields([]);
      setFieldValues({});
      return;
    }
    void loadFieldsForType(newTypeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTypeId]);

  async function loadTypesAndEntities() {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const [typesRes, entRes] = await Promise.all([
      fetch("/api/entity-types", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/entities", { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const typesJson = await typesRes.json().catch(() => ({}));
    const entJson = await entRes.json().catch(() => ({}));

    if (!typesRes.ok) {
      setMsg(typesJson.error || "No se pudieron cargar tipos");
      return;
    }
    if (!entRes.ok) {
      setMsg(entJson.error || "No se pudieron cargar entidades");
      return;
    }

    const t = Array.isArray(typesJson.entity_types) ? typesJson.entity_types : [];
    const e = Array.isArray(entJson.entities) ? entJson.entities : [];
    setTypes(t);
    setEntities(e);

    if (!newTypeId && t.length) setNewTypeId(t[0].id);
  }

  async function loadFieldsForType(typeId: string) {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/entity-fields?entity_type_id=${encodeURIComponent(typeId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar campos del tipo");
      return;
    }

    const f = Array.isArray(json.entity_fields) ? json.entity_fields : [];
    setTypeFields(f);

    const initial: Record<string, string> = {};
    f.forEach((x: any) => (initial[x.id] = ""));
    setFieldValues(initial);
  }

  async function createEntity() {
    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const name = newName.trim();
    if (!name) {
      setMsg("Nombre requerido");
      setBusy(false);
      return;
    }
    if (!newTypeId) {
      setMsg("Tipo requerido");
      setBusy(false);
      return;
    }

    const payload = {
      name,
      entity_type_id: newTypeId,
      tracks_usage: newTracksUsage,
      field_values: Object.entries(fieldValues).map(([entity_field_id, value_text]) => ({
        entity_field_id,
        value_text,
      })),
    };

    const res = await fetch("/api/entities", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo crear entidad");
      setBusy(false);
      return;
    }

    setCreating(false);
    setNewName("");
    setNewTracksUsage(false);

    await loadTypesAndEntities();

    const id = json?.entity?.id as string | undefined;
    if (id) router.push(`/app/entities/${id}`);

    setBusy(false);
  }

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Entidades</h2>
          <p style={{ opacity: 0.75, marginTop: 6 }}>
            Crea entidades y visualiza su ficha. (Fase 1.2)
          </p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setCreating((v) => !v)} style={{ padding: 10 }}>
            {creating ? "Cerrar" : "Crear entidad"}
          </button>
          <button onClick={loadTypesAndEntities} disabled={busy} style={{ padding: 10 }}>
            Refrescar
          </button>
        </div>
      </div>

      {msg && <p style={{ marginTop: 10, color: "crimson", whiteSpace: "pre-wrap" }}>{msg}</p>}

      {creating && (
        <section style={{ marginTop: 16, border: "1px solid #eee", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Nueva entidad</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12 }}>
            <div>
              <label>Nombre</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Retroexcavadora 320"
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                disabled={busy}
              />
            </div>

            <div>
              <label>Tipo</label>
              <select
                value={newTypeId}
                onChange={(e) => setNewTypeId(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                disabled={busy}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={newTracksUsage}
                  onChange={(e) => setNewTracksUsage(e.target.checked)}
                  disabled={busy}
                />
                tracks_usage (registrar uso)
              </label>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <h4 style={{ margin: 0 }}>Campos ({selectedType?.name ?? ""})</h4>
            <p style={{ opacity: 0.7, marginTop: 6 }}>
              Los campos se definen en /app/entity-types.
            </p>

            {typeFields.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Este tipo no tiene campos.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
                {typeFields.map((f) => (
                  <div key={f.id} style={{ border: "1px solid #f3f3f3", padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{f.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      key: <span style={{ fontFamily: "monospace" }}>{f.key}</span> · type: {f.field_type}
                    </div>

                    <input
                      value={fieldValues[f.id] ?? ""}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [f.id]: e.target.value }))
                      }
                      placeholder=""
                      style={{ width: "100%", padding: 10, marginTop: 8 }}
                      disabled={busy}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={createEntity} disabled={busy} style={{ padding: 12, minWidth: 180 }}>
              {busy ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        {entities.length === 0 ? (
          <p style={{ opacity: 0.7 }}>Aún no hay entidades.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            {entities.map((e) => (
              <button
                key={e.id}
                onClick={() => router.push(`/app/entities/${e.id}`)}
                style={{
                  textAlign: "left",
                  border: "1px solid #eee",
                  padding: 12,
                  background: "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 16 }}>{e.name}</div>
                <div style={{ opacity: 0.75, marginTop: 6 }}>
                  {e.entity_type_name || "(tipo)"} · {e.tracks_usage ? "tracks_usage" : "no usage"}
                </div>
                <div style={{ opacity: 0.65, fontSize: 12, marginTop: 6 }}>
                  {new Date(e.created_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
