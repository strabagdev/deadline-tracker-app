"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type EntityDetail = {
  id: string;
  name: string;
  entity_type_id: string;
  tracks_usage: boolean;
  created_at: string;
  entity_type: { id: string; name: string; icon: string | null } | null;
  fields: Array<{
    id: string;
    name: string;
    key: string;
    field_type: string;
    show_in_card: boolean;
    options: any;
    created_at: string;
    value_text: string;
    value_updated_at: string | null;
  }>;
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

export default function EntityDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = String(params?.id ?? "");

  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // edit state
  const [editMode, setEditMode] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTracksUsage, setDraftTracksUsage] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  const canSave = useMemo(() => {
    if (!entity) return false;
    if (draftName.trim() === "") return false;
    return true;
  }, [entity, draftName]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function hydrateDraft(from: EntityDetail) {
    setDraftName(from.name);
    setDraftTracksUsage(from.tracks_usage);

    const map: Record<string, string> = {};
    from.fields.forEach((f) => (map[f.id] = f.value_text ?? ""));
    setDraftValues(map);
  }

  async function load() {
    setLoading(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/entities?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo cargar la entidad");
      setEntity(null);
      setLoading(false);
      return;
    }

    const e = json.entity ?? null;
    setEntity(e);
    setLoading(false);

    if (e && !editMode) hydrateDraft(e);
  }

  async function save() {
    if (!entity) return;
    if (!canSave) return;

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const payload = {
      name: draftName.trim(),
      tracks_usage: draftTracksUsage,
      field_values: Object.entries(draftValues).map(([entity_field_id, value_text]) => ({
        entity_field_id,
        value_text,
      })),
    };

    const res = await fetch(`/api/entities?id=${encodeURIComponent(entity.id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo guardar");
      setBusy(false);
      return;
    }

    setEditMode(false);
    await load();
    setBusy(false);
  }

  async function removeEntity() {
    if (!entity) return;

    const ok = window.confirm("¿Eliminar esta entidad? Esto borrará también sus valores asociados.");
    if (!ok) return;

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) return;

    const res = await fetch(`/api/entities?id=${encodeURIComponent(entity.id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo eliminar");
      setBusy(false);
      return;
    }

    router.push("/app/entities");
  }

  return (
    <main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push("/app/entities")} style={{ padding: 10 }}>
          ← Volver
        </button>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ padding: 10 }} disabled={busy}>
            Refrescar
          </button>

          {!editMode ? (
            <button
              onClick={() => {
                if (entity) hydrateDraft(entity);
                setEditMode(true);
              }}
              style={{ padding: 10 }}
              disabled={!entity || busy}
            >
              Editar
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  if (entity) hydrateDraft(entity);
                  setEditMode(false);
                  setMsg("");
                }}
                style={{ padding: 10 }}
                disabled={busy}
              >
                Cancelar
              </button>
              <button onClick={save} style={{ padding: 10, fontWeight: 700 }} disabled={busy || !canSave}>
                {busy ? "Guardando..." : "Guardar"}
              </button>
            </>
          )}

          <button onClick={removeEntity} style={{ padding: 10 }} disabled={!entity || busy}>
            Eliminar
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ marginTop: 16 }}>Cargando...</p>
      ) : msg ? (
        <p style={{ marginTop: 16, color: "crimson", whiteSpace: "pre-wrap" }}>{msg}</p>
      ) : !entity ? (
        <p style={{ marginTop: 16, opacity: 0.75 }}>No encontrada.</p>
      ) : (
        <>
          <section style={{ marginTop: 16, border: "1px solid #eee", padding: 12 }}>
            {!editMode ? (
              <>
                <h2 style={{ margin: 0 }}>{entity.name}</h2>
                <div style={{ opacity: 0.75, marginTop: 6 }}>
                  Tipo: <strong>{entity.entity_type?.name ?? "(sin tipo)"}</strong> ·{" "}
                  {entity.tracks_usage ? "tracks_usage" : "no usage"}
                </div>
                <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>
                  Creado: {new Date(entity.created_at).toLocaleString()}
                </div>
              </>
            ) : (
              <>
                <h2 style={{ marginTop: 0 }}>Editar entidad</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12 }}>
                  <div>
                    <label>Nombre</label>
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      style={{ width: "100%", padding: 10, marginTop: 6 }}
                      disabled={busy}
                    />
                  </div>
                  <div>
                    <label>Tipo</label>
                    <input
                      value={entity.entity_type?.name ?? ""}
                      disabled
                      style={{ width: "100%", padding: 10, marginTop: 6, opacity: 0.7 }}
                    />
                    <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                      <input
                        type="checkbox"
                        checked={draftTracksUsage}
                        onChange={(e) => setDraftTracksUsage(e.target.checked)}
                        disabled={busy}
                      />
                      tracks_usage (registrar uso)
                    </label>
                  </div>
                </div>
              </>
            )}
          </section>

          <section style={{ marginTop: 16, border: "1px solid #eee", padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Campos</h3>

            {entity.fields.length === 0 ? (
              <p style={{ opacity: 0.7 }}>Este tipo no tiene campos definidos.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                {entity.fields.map((f) => (
                  <div key={f.id} style={{ border: "1px solid #f3f3f3", padding: 10 }}>
                    <div style={{ fontWeight: 700 }}>{f.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      <span style={{ fontFamily: "monospace" }}>{f.key}</span> · {f.field_type}
                    </div>

                    {!editMode ? (
                      <div style={{ marginTop: 10, fontSize: 14 }}>
                        {f.value_text ? (
                          <strong>{f.value_text}</strong>
                        ) : (
                          <span style={{ opacity: 0.55 }}>(sin valor)</span>
                        )}
                      </div>
                    ) : (
                      <input
                        value={draftValues[f.id] ?? ""}
                        onChange={(e) => setDraftValues((prev) => ({ ...prev, [f.id]: e.target.value }))}
                        style={{ width: "100%", padding: 10, marginTop: 10 }}
                        disabled={busy}
                      />
                    )}

                    {!editMode && f.value_updated_at && (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
                        actualizado: {new Date(f.value_updated_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section style={{ marginTop: 16, border: "1px dashed #ddd", padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Próximo: Vencimientos (Fase 2)</h3>
            <p style={{ opacity: 0.75, marginTop: 6 }}>
              Aquí iremos agregando deadlines (por fecha y por uso) y los registros de uso.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
