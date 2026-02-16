"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import EntityDeadlinesManager from "@/components/deadlines/EntityDeadlinesManager";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

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
    options: unknown;
    created_at: string;
    value_text: string;
    value_updated_at: string | null;
  }>;
};

async function getTokenOrRedirect(router: { replace: (path: string) => void }) {
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
    if (!entity || !canSave) return;

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
    <main className="mx-auto max-w-[1200px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Ficha de entidad</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => router.push("/app/entities")} variant="outline" size="sm">
                ← Volver
              </Button>
              <Button onClick={load} variant="outline" size="sm" disabled={busy}>
                Refrescar
              </Button>
              {!editMode ? (
                <Button
                  onClick={() => {
                    if (entity) hydrateDraft(entity);
                    setEditMode(true);
                  }}
                  variant="outline"
                  size="sm"
                  disabled={!entity || busy}
                >
                  Editar
                </Button>
              ) : (
                <>
                  <Button
                    onClick={() => {
                      if (entity) hydrateDraft(entity);
                      setEditMode(false);
                      setMsg("");
                    }}
                    variant="outline"
                    size="sm"
                    disabled={busy}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={save} size="sm" disabled={busy || !canSave}>
                    {busy ? "Guardando..." : "Guardar"}
                  </Button>
                </>
              )}
              <Button onClick={removeEntity} variant="outline" size="sm" disabled={!entity || busy}>
                Eliminar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader label="Cargando entidad..." />
        </div>
      ) : msg ? (
        <p className="whitespace-pre-wrap text-sm text-rose-600">{msg}</p>
      ) : !entity ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-slate-600">No encontrada.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              {!editMode ? (
                <div className="space-y-2">
                  <CardTitle>{entity.name}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Tipo: {entity.entity_type?.name ?? "(sin tipo)"}</Badge>
                    <Badge variant="outline">{entity.tracks_usage ? "Registra uso" : "Sin uso"}</Badge>
                    <Badge variant="outline">Creado: {new Date(entity.created_at).toLocaleDateString()}</Badge>
                  </div>
                </div>
              ) : (
                <CardTitle>Editar entidad</CardTitle>
              )}
            </CardHeader>
            {editMode ? (
              <CardContent className="pt-0">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Nombre
                    <Input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="grid gap-1.5 text-xs text-slate-600">
                    <span>Tipo</span>
                    <Input value={entity.entity_type?.name ?? ""} disabled />
                    <label className="mt-1 flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={draftTracksUsage}
                        onChange={(e) => setDraftTracksUsage(e.target.checked)}
                        disabled={busy}
                        className="h-4 w-4"
                      />
                      tracks_usage (registrar uso)
                    </label>
                  </div>
                </div>
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Campos</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {entity.fields.length === 0 ? (
                <p className="text-sm text-slate-600">Este tipo no tiene campos definidos.</p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {entity.fields.map((f) => (
                    <div key={f.id} className="rounded-xl border bg-slate-50 p-3">
                      <div className="text-sm font-semibold text-slate-900">{f.name}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        <span className="font-mono">{f.key}</span> · {f.field_type}
                      </div>

                      {!editMode ? (
                        <div className="mt-3 text-sm">
                          {f.value_text ? (
                            <span className="font-medium text-slate-900">{f.value_text}</span>
                          ) : (
                            <span className="text-slate-500">(sin valor)</span>
                          )}
                        </div>
                      ) : (
                        <Input
                          value={draftValues[f.id] ?? ""}
                          onChange={(e) => setDraftValues((prev) => ({ ...prev, [f.id]: e.target.value }))}
                          className="mt-3"
                          disabled={busy}
                        />
                      )}

                      {!editMode && f.value_updated_at ? (
                        <div className="mt-2 text-[11px] text-slate-500">
                          actualizado: {new Date(f.value_updated_at).toLocaleString()}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <section>
            <EntityDeadlinesManager entityId={entity.id} tracksUsage={entity.tracks_usage} />
          </section>
        </>
      )}
    </main>
  );
}
