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
  usage_unit_id?: string | null;
  created_at: string;
  entity_type: { id: string; name: string; icon: string | null } | null;
  usage_unit?: { id: string; name: string; is_active: boolean } | null;
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

type UsageUnit = { id: string; name: string; is_active: boolean };
type DeadlineHistoryRow = {
  id: string;
  deadline_type_id: string;
  version_group_id?: string | null;
  version_no?: number | null;
  is_current?: boolean;
  created_at: string;
  superseded_at?: string | null;
  next_due_date?: string | null;
  last_done_usage?: number | null;
  deadline_types?:
    | { id?: string; name?: string | null; measure_by?: "date" | "usage" | null }
    | { id?: string; name?: string | null; measure_by?: "date" | "usage" | null }[]
    | null;
  computed?: {
    status?: string;
    semaphore?: string | null;
  } | null;
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
  const [role, setRole] = useState<string>("");
  const [usageUnits, setUsageUnits] = useState<UsageUnit[]>([]);
  const [deadlineHistory, setDeadlineHistory] = useState<DeadlineHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyMsg, setHistoryMsg] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const [editMode, setEditMode] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTracksUsage, setDraftTracksUsage] = useState(false);
  const [draftUsageUnitId, setDraftUsageUnitId] = useState<string>("");
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});

  const canSave = useMemo(() => {
    if (!entity) return false;
    if (draftName.trim() === "") return false;
    return true;
  }, [entity, draftName]);
  const canDelete = role === "owner" || role === "admin";
  const sortedDeadlineHistory = useMemo(() => {
    const getTypeName = (d: DeadlineHistoryRow) => {
      const v = pickOne(d.deadline_types);
      return String(v?.name ?? "Vencimiento");
    };
    return [...deadlineHistory].sort((a, b) => {
      const byType = getTypeName(a).localeCompare(getTypeName(b));
      if (byType !== 0) return byType;
      return Number(a.version_no ?? 1) - Number(b.version_no ?? 1);
    });
  }, [deadlineHistory]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function pickOne<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  }

  function hydrateDraft(from: EntityDetail) {
    setDraftName(from.name);
    setDraftTracksUsage(from.tracks_usage);
    setDraftUsageUnitId(String(from.usage_unit_id ?? ""));
    const map: Record<string, string> = {};
    from.fields.forEach((f) => (map[f.id] = f.value_text ?? ""));
    setDraftValues(map);
  }

  async function load() {
    setLoading(true);
    setMsg("");
    setHistoryLoading(true);
    setHistoryMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) {
      setHistoryLoading(false);
      return;
    }

    const [res, roleRes, unitsRes, historyRes] = await Promise.all([
      fetch(`/api/entities?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch("/api/settings/semaphore", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch("/api/usage-units?active=1", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`/api/deadlines?entity_id=${encodeURIComponent(id)}&include_history=true`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    const json = await res.json().catch(() => ({}));
    const roleJson = await roleRes.json().catch(() => ({}));
    const unitsJson = await unitsRes.json().catch(() => ({}));
    const historyJson = await historyRes.json().catch(() => ({}));
    setRole(typeof roleJson?.role === "string" ? roleJson.role : "");
    if (!res.ok) {
      setMsg(json.error || "No se pudo cargar la entidad");
      setEntity(null);
      setLoading(false);
      return;
    }

    const e = json.entity ?? null;
    setEntity(e);
    if (unitsRes.ok) {
      setUsageUnits((unitsJson.usage_units ?? []) as UsageUnit[]);
    } else {
      setUsageUnits([]);
    }
    setHistoryLoading(false);
    if (historyRes.ok) {
      const history = Array.isArray(historyJson.history) ? (historyJson.history as DeadlineHistoryRow[]) : [];
      setDeadlineHistory(history);
      setHistoryMsg("");
    } else {
      setDeadlineHistory([]);
      setHistoryMsg(historyJson.error || "No se pudo cargar el histórico de vencimientos.");
    }
    setLoading(false);

    if (e && !editMode) hydrateDraft(e);
  }

  async function save() {
    if (!entity || !canSave) return;

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

    const payload = {
      name: draftName.trim(),
      tracks_usage: draftTracksUsage,
      usage_unit_id: draftTracksUsage ? (draftUsageUnitId || null) : null,
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
    if (!canDelete) {
      setMsg("Solo owner/admin puede eliminar entidades.");
      return;
    }

    const typed = window.prompt(
      `Esta acción no se puede deshacer.\n\nPara eliminar la entidad, escribe su nombre exacto:\n${entity.name}`
    );
    if (typed === null) return;
    if (typed.trim() !== entity.name) {
      setMsg("El nombre ingresado no coincide. Eliminación cancelada.");
      return;
    }

    setBusy(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

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

    router.push("/app/entities?deleted=1");
  }

  return (
    <main className="mx-auto max-w-[1200px] space-y-5 px-4 py-4 sm:space-y-6">
      <section className="rounded-[var(--radius-lg)] bg-[var(--muted)]/70 px-3 py-2 sm:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Ficha de entidad</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => router.push("/app/entities")} variant="outline" size="sm" className="bg-[var(--card)]/85">
              ← Volver
            </Button>
            <Button onClick={load} variant="outline" size="sm" disabled={busy} className="bg-[var(--card)]/85">
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
                className="bg-[var(--card)]/85"
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
                  className="bg-[var(--card)]/85"
                >
                  Cancelar
                </Button>
                <Button onClick={save} size="sm" disabled={busy || !canSave}>
                  {busy ? "Guardando..." : "Guardar"}
                </Button>
              </>
            )}
            <Button
              onClick={removeEntity}
              variant="destructive"
              size="sm"
              disabled={!entity || busy || !canDelete}
            >
              Eliminar
            </Button>
          </div>
        </div>
      </section>

      {loading ? (
        <div className="flex min-h-[60vh] items-center justify-center py-6">
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
                <div className="space-y-4">
                  <div className="space-y-1">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Entidad</div>
                    <CardTitle className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                      {entity.name}
                    </CardTitle>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Tipo: {entity.entity_type?.name ?? "(sin tipo)"}</Badge>
                    <Badge variant="outline">{entity.tracks_usage ? "Registra uso" : "Sin uso"}</Badge>
                    {entity.tracks_usage ? (
                      <Badge variant="outline">Unidad: {entity.usage_unit?.name ?? "Sin unidad"}</Badge>
                    ) : null}
                    <Badge variant="outline">Creado: {new Date(entity.created_at).toLocaleDateString()}</Badge>
                    {!canDelete ? <Badge variant="outline">Eliminar: solo owner/admin</Badge> : null}
                  </div>
                </div>
              ) : (
                <CardTitle>Editar entidad</CardTitle>
              )}
            </CardHeader>
            {editMode ? (
              <CardContent className="pt-0">
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-12 lg:items-end">
                  <label className="grid gap-1.5 text-xs text-slate-600 lg:col-span-4">
                    Nombre
                    <Input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <div className="grid gap-1.5 text-xs text-slate-600 lg:col-span-3">
                    <span>Tipo</span>
                    <Input value={entity.entity_type?.name ?? ""} disabled />
                  </div>
                  <label className="flex h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--input)] px-3 text-[13px] text-[var(--muted-foreground)] sm:text-sm lg:col-span-2">
                    <input
                      type="checkbox"
                      checked={draftTracksUsage}
                      onChange={(e) => setDraftTracksUsage(e.target.checked)}
                      disabled={busy}
                      className="h-4 w-4"
                    />
                    Registrar uso
                  </label>
                  <div className="grid gap-1 lg:col-span-3">
                    <span className="text-[11px] font-medium text-slate-500">Unidad de uso</span>
                    <select
                      value={draftUsageUnitId}
                      onChange={(e) => setDraftUsageUnitId(e.target.value)}
                      disabled={busy || !draftTracksUsage}
                      className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm disabled:bg-[var(--muted)]"
                    >
                      <option value="">Sin unidad</option>
                      {usageUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
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
                    <div key={f.id} className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--muted)]/70 p-3">
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

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Histórico de vencimientos</CardTitle>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setHistoryExpanded((v) => !v)}
                >
                  {historyExpanded ? "Comprimir" : "Expandir"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className={historyExpanded ? "pt-0" : "hidden"}>
              {historyLoading ? <Loader label="Cargando histórico..." /> : null}
              {!historyLoading && historyMsg ? <p className="text-sm text-rose-600">{historyMsg}</p> : null}
              {!historyLoading && !historyMsg && deadlineHistory.length === 0 ? (
                <p className="text-sm text-slate-600">No hay histórico para esta entidad.</p>
              ) : null}
              {!historyLoading && !historyMsg && sortedDeadlineHistory.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="px-2 py-2 text-left">Tipo</th>
                        <th className="px-2 py-2 text-left">Versión</th>
                        <th className="px-2 py-2 text-left">Estado</th>
                        <th className="px-2 py-2 text-left">Vigente</th>
                        <th className="px-2 py-2 text-left">Creado</th>
                        <th className="px-2 py-2 text-left">Reemplazado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedDeadlineHistory.map((d) => {
                        const dt = pickOne(d.deadline_types);
                        const typeName = dt?.name ?? "Vencimiento";
                        const state = d.computed?.semaphore ?? d.computed?.status ?? "—";
                        return (
                          <tr key={d.id} className="border-b border-slate-100">
                            <td className="px-2 py-2">{typeName}</td>
                            <td className="px-2 py-2">v{Number(d.version_no ?? 1)}</td>
                            <td className="px-2 py-2">{String(state)}</td>
                            <td className="px-2 py-2">
                              <Badge variant="outline">{d.is_current ? "Sí" : "No"}</Badge>
                            </td>
                            <td className="px-2 py-2">{new Date(d.created_at).toLocaleString()}</td>
                            <td className="px-2 py-2">{d.superseded_at ? new Date(d.superseded_at).toLocaleString() : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
