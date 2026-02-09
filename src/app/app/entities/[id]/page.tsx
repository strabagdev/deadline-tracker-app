"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

    setEntity(json.entity ?? null);
    setLoading(false);
  }

  return (
    <main style={{ padding: 16, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <button onClick={() => router.push("/app/entities")} style={{ padding: 10 }}>
          ← Volver
        </button>
        <button onClick={load} style={{ padding: 10 }}>
          Refrescar
        </button>
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
            <h2 style={{ margin: 0 }}>{entity.name}</h2>
            <div style={{ opacity: 0.75, marginTop: 6 }}>
              Tipo: <strong>{entity.entity_type?.name ?? "(sin tipo)"}</strong> ·{" "}
              {entity.tracks_usage ? "tracks_usage" : "no usage"}
            </div>
            <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>
              Creado: {new Date(entity.created_at).toLocaleString()}
            </div>
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

                    <div style={{ marginTop: 10, fontSize: 14 }}>
                      {f.value_text ? <strong>{f.value_text}</strong> : <span style={{ opacity: 0.55 }}>(sin valor)</span>}
                    </div>

                    {f.value_updated_at && (
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
