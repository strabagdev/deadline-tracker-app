"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

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

function measureTone(measureBy: DeadlineType["measure_by"]) {
  return measureBy === "usage"
    ? "border-cyan-200 bg-cyan-50 text-cyan-700"
    : "border-violet-200 bg-violet-50 text-violet-700";
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

export default function DeadlineTypesPage() {
  const router = useRouter();

  const [items, setItems] = useState<DeadlineType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const [name, setName] = useState("");
  const [measureBy, setMeasureBy] = useState<"date" | "usage">("date");
  const [requiresDoc, setRequiresDoc] = useState(false);
  const [search, setSearch] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMeasureBy, setEditMeasureBy] = useState<"date" | "usage">("date");
  const [editRequiresDoc, setEditRequiresDoc] = useState(false);
  const [editIsActive, setEditIsActive] = useState(true);

  const canCreate = useMemo(() => name.trim().length > 0, [name]);
  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.name.toLowerCase().includes(needle));
  }, [items, search]);
  const activeCount = useMemo(() => items.filter((item) => item.is_active).length, [items]);
  const usageCount = useMemo(() => items.filter((item) => item.measure_by === "usage").length, [items]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    setLoading(true);
    setMsg("");

    const token = await getTokenOrRedirect(router);
    if (!token) {
      setLoading(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <section className="rounded-[26px] border border-[rgba(17,32,28,0.08)] bg-[linear-gradient(180deg,rgba(251,253,252,0.98),rgba(245,249,248,0.96))] p-4 shadow-[0_20px_60px_-44px_rgba(15,23,42,0.3)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-900 text-white hover:bg-slate-900">Configuración</Badge>
              <Badge variant="secondary" className="bg-cyan-50 text-cyan-700 hover:bg-cyan-50">
                Tipos de vencimiento
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Catálogo operativo de vencimientos
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Define cómo se mide cada vencimiento y si exige respaldo documental.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Tipos</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{items.length}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Activos</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{activeCount}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Por uso</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{usageCount}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {msg ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {msg}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Nuevo tipo</div>
              <CardTitle className="text-base sm:text-lg">Crear regla de vencimiento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nombre</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej: Certificado de gases"
                  disabled={busy}
                />
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Medición</label>
                <select
                  value={measureBy}
                  onChange={(e) => setMeasureBy(e.target.value as "date" | "usage")}
                  className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                  disabled={busy}
                >
                  {MEASURE_BY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 py-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={requiresDoc}
                  onChange={(e) => setRequiresDoc(e.target.checked)}
                  disabled={busy}
                />
                Requiere documento de respaldo
              </label>

              <Button onClick={create} disabled={busy || !canCreate} className="w-full">
                Crear tipo
              </Button>
            </CardContent>
          </Card>

          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Navegación</div>
              <CardTitle className="text-base sm:text-lg">Tipos disponibles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tipo..."
                disabled={busy}
              />
              <div className="grid gap-2">
                {filteredItems.length === 0 ? (
                  <p className="text-sm text-slate-500">No hay tipos para mostrar.</p>
                ) : (
                  filteredItems.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <Badge variant="secondary" className={cn("border", measureTone(item.measure_by))}>
                              {item.measure_by === "usage" ? "Por uso" : "Por fecha"}
                            </Badge>
                            {!item.is_active ? (
                              <Badge variant="secondary" className="border border-slate-200 bg-slate-100 text-slate-600">
                                Inactivo
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Listado</div>
                <CardTitle className="text-base sm:text-lg">Configuración existente</CardTitle>
              </div>
              <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={busy || loading}>
                Refrescar
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {loading ? (
              <div className="flex min-h-[60vh] items-center justify-center py-6">
                <Loader label="Cargando tipos..." />
              </div>
            ) : filteredItems.length === 0 ? (
              <p className="text-sm text-slate-500">Aún no hay tipos creados.</p>
            ) : (
              filteredItems.map((row) => {
                const isEditing = editingId === row.id;

                return (
                  <div
                    key={row.id}
                    className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.45)]"
                  >
                    {!isEditing ? (
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-base font-semibold text-slate-900">{row.name}</div>
                            <Badge variant="secondary" className={cn("border", measureTone(row.measure_by))}>
                              {row.measure_by === "usage" ? "Por uso" : "Por fecha"}
                            </Badge>
                            {row.requires_document ? (
                              <Badge variant="secondary" className="border border-emerald-200 bg-emerald-50 text-emerald-700">
                                Requiere documento
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="border border-slate-200 bg-slate-50 text-slate-600">
                                Sin documento
                              </Badge>
                            )}
                            {!row.is_active ? (
                              <Badge variant="secondary" className="border border-slate-200 bg-slate-100 text-slate-600">
                                Inactivo
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-slate-500">
                            Creado el {new Date(row.created_at).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => startEdit(row)} disabled={busy}>
                            Editar
                          </Button>
                          {row.is_active ? (
                            <Button variant="outline" size="sm" onClick={() => void deactivate(row.id)} disabled={busy}>
                              Desactivar
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Edición</div>
                          <div className="mt-1 text-base font-semibold text-slate-900">Actualizar tipo</div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.3fr)_180px_220px_180px]">
                          <div className="grid gap-2">
                            <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nombre</label>
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              disabled={busy}
                            />
                          </div>

                          <div className="grid gap-2">
                            <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Medición</label>
                            <select
                              value={editMeasureBy}
                              onChange={(e) => setEditMeasureBy(e.target.value as "date" | "usage")}
                              className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                              disabled={busy}
                            >
                              {MEASURE_BY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 py-2.5 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={editRequiresDoc}
                              onChange={(e) => setEditRequiresDoc(e.target.checked)}
                              disabled={busy}
                            />
                            Requiere documento
                          </label>

                          <label className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 py-2.5 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={editIsActive}
                              onChange={(e) => setEditIsActive(e.target.checked)}
                              disabled={busy}
                            />
                            Activo
                          </label>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={cancelEdit} disabled={busy}>
                            Cancelar
                          </Button>
                          <Button size="sm" onClick={saveEdit} disabled={busy}>
                            {busy ? "Guardando..." : "Guardar cambios"}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
