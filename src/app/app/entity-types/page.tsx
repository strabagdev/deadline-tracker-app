"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

function toSlugKey(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fieldTypeTone(fieldType: EntityField["field_type"]) {
  if (fieldType === "number") return "border-sky-200 bg-sky-50 text-sky-700";
  if (fieldType === "date") return "border-violet-200 bg-violet-50 text-violet-700";
  if (fieldType === "boolean") return "border-amber-200 bg-amber-50 text-amber-700";
  if (fieldType === "select") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function analyticsTone(mode: EntityField["analytics_mode"]) {
  if (mode === "distribution") return "border-cyan-200 bg-cyan-50 text-cyan-700";
  if (mode === "trend") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (mode === "count") return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700";
  return "border-slate-200 bg-slate-50 text-slate-500";
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
  const [fields, setFields] = useState<EntityField[]>([]);

  const [newTypeName, setNewTypeName] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<EntityField["field_type"]>("text");
  const [newShowInCard, setNewShowInCard] = useState(false);
  const [newAnalyticsMode, setNewAnalyticsMode] = useState<EntityField["analytics_mode"]>("none");
  const [editingFieldId, setEditingFieldId] = useState<string>("");
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const [typeSearch, setTypeSearch] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const selected = useMemo(() => types.find((t) => t.id === selectedId) ?? null, [types, selectedId]);
  const filteredTypes = useMemo(() => {
    const needle = typeSearch.trim().toLowerCase();
    if (!needle) return types;
    return types.filter((type) => type.name.toLowerCase().includes(needle));
  }, [types, typeSearch]);
  const visibleOnCardCount = useMemo(() => fields.filter((field) => field.show_in_card).length, [fields]);
  const analyticsFieldCount = useMemo(() => fields.filter((field) => field.analytics_mode !== "none").length, [fields]);

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (selectedId && !list.some((type: EntityType) => type.id === selectedId)) {
      setSelectedId(list[0]?.id ?? "");
    }
  }

  async function createType() {
    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

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

    const createdId = String(json?.entity_type?.id ?? "");
    setNewTypeName("");
    await loadTypes();
    if (createdId) setSelectedId(createdId);
    setBusy(false);
  }

  async function loadFields(entityTypeId: string) {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/entity-fields?entity_type_id=${encodeURIComponent(entityTypeId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <section className="rounded-[26px] border border-[rgba(17,32,28,0.08)] bg-[linear-gradient(180deg,rgba(251,253,252,0.98),rgba(245,249,248,0.96))] p-4 shadow-[0_20px_60px_-44px_rgba(15,23,42,0.3)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-900 text-white hover:bg-slate-900">Configuración</Badge>
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                Tipos de entidad
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Estructura base de entidades
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Define los tipos operativos y los campos que describen cada entidad.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Tipos</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{types.length}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Campos visibles</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{visibleOnCardCount}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Analíticos</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{analyticsFieldCount}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {msg ? (
        <div className={cn(
          "rounded-2xl border px-4 py-3 text-sm",
          "border-rose-200 bg-rose-50 text-rose-700"
        )}>
          {msg}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Nuevo tipo</div>
              <CardTitle className="text-base sm:text-lg">Crear tipo de entidad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                placeholder="Ej: Máquina, Vehículo, Persona"
                disabled={busy}
              />
              <Button onClick={createType} disabled={busy || !newTypeName.trim()} className="w-full">
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
                value={typeSearch}
                onChange={(e) => setTypeSearch(e.target.value)}
                placeholder="Buscar tipo..."
                disabled={busy}
              />
              {filteredTypes.length === 0 ? (
                <p className="text-sm text-slate-500">No hay tipos para mostrar.</p>
              ) : (
                <div className="grid gap-2">
                  {filteredTypes.map((type) => {
                    const active = type.id === selectedId;
                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setSelectedId(type.id)}
                        disabled={busy}
                        className={cn(
                          "rounded-2xl border px-3 py-3 text-left transition-colors",
                          active
                            ? "border-slate-300 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                        )}
                      >
                        <div className="text-sm font-semibold">{type.name}</div>
                        <div className={cn("mt-1 text-xs", active ? "text-white/70" : "text-slate-500")}>
                          Abrir estructura de campos
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {!selected ? (
            <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
              <CardContent className="px-6 py-10 text-center text-sm text-slate-500">
                Selecciona un tipo para configurar sus campos.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Tipo seleccionado</div>
                      <CardTitle className="text-lg sm:text-xl">{selected.name}</CardTitle>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {fields.length} campos
                      </Badge>
                      <Badge variant="secondary" className="bg-sky-50 text-sky-700 hover:bg-sky-50">
                        {visibleOnCardCount} visibles
                      </Badge>
                      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                        {analyticsFieldCount} analíticos
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-slate-500">
                    Usa este tipo como plantilla estructural para todas las entidades de esta categoría.
                  </p>
                </CardContent>
              </Card>

              <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
                <CardHeader className="pb-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Nuevo campo</div>
                  <CardTitle className="text-base sm:text-lg">Agregar campo al tipo</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.3fr)_180px_180px_180px_auto] xl:items-end">
                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nombre</label>
                    <Input
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder="Ej: Patente, Serie, Centro de costo"
                      disabled={busy}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Tipo de dato</label>
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value as EntityField["field_type"])}
                      className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                      disabled={busy}
                    >
                      <option value="text">Texto</option>
                      <option value="number">Número</option>
                      <option value="date">Fecha</option>
                      <option value="boolean">Booleano</option>
                      <option value="select">Selección</option>
                    </select>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Mostrar en tarjeta</label>
                    <label className="flex h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={newShowInCard}
                        onChange={(e) => setNewShowInCard(e.target.checked)}
                        disabled={busy}
                      />
                      Visible
                    </label>
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Modo analítico</label>
                    <select
                      value={newAnalyticsMode}
                      onChange={(e) => setNewAnalyticsMode(e.target.value as EntityField["analytics_mode"])}
                      className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                      disabled={busy}
                    >
                      <option value="none">Sin analítica</option>
                      <option value="distribution">Distribución</option>
                      <option value="trend">Tendencia</option>
                      <option value="count">Conteo</option>
                    </select>
                  </div>

                  <Button onClick={createField} disabled={busy || !newFieldName.trim()} className="w-full xl:w-auto">
                    Agregar campo
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
                <CardHeader className="pb-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Estructura</div>
                  <CardTitle className="text-base sm:text-lg">Campos configurados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {fields.length === 0 ? (
                    <p className="text-sm text-slate-500">Este tipo aún no tiene campos configurados.</p>
                  ) : (
                    <div className="grid gap-3">
                      {fields.map((field) => {
                        const isEditing = editingFieldId === field.id;
                        return (
                          <div
                            key={field.id}
                            className="rounded-[22px] border border-slate-200 bg-[rgba(248,250,252,0.82)] p-4"
                          >
                            {isEditing ? (
                              <div className="grid gap-3 lg:grid-cols-[minmax(220px,1.2fr)_170px_170px_170px_auto] lg:items-end">
                                <div className="grid gap-2">
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nombre</label>
                                  <Input
                                    value={fieldDraft?.name ?? ""}
                                    onChange={(e) =>
                                      setFieldDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                                    }
                                    disabled={busy}
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Key</label>
                                  <Input
                                    value={fieldDraft?.key ?? ""}
                                    onChange={(e) =>
                                      setFieldDraft((prev) => (prev ? { ...prev, key: toSlugKey(e.target.value) } : prev))
                                    }
                                    disabled={busy}
                                  />
                                </div>
                                <div className="grid gap-2">
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Tipo</label>
                                  <select
                                    value={fieldDraft?.field_type ?? "text"}
                                    onChange={(e) =>
                                      setFieldDraft((prev) =>
                                        prev ? { ...prev, field_type: e.target.value as EntityField["field_type"] } : prev
                                      )
                                    }
                                    className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                                    disabled={busy}
                                  >
                                    <option value="text">Texto</option>
                                    <option value="number">Número</option>
                                    <option value="date">Fecha</option>
                                    <option value="boolean">Booleano</option>
                                    <option value="select">Selección</option>
                                  </select>
                                </div>
                                <div className="grid gap-2">
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Analítica</label>
                                  <select
                                    value={fieldDraft?.analytics_mode ?? "none"}
                                    onChange={(e) =>
                                      setFieldDraft((prev) =>
                                        prev
                                          ? { ...prev, analytics_mode: e.target.value as EntityField["analytics_mode"] }
                                          : prev
                                      )
                                    }
                                    className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                                    disabled={busy}
                                  >
                                    <option value="none">Sin analítica</option>
                                    <option value="distribution">Distribución</option>
                                    <option value="trend">Tendencia</option>
                                    <option value="count">Conteo</option>
                                  </select>
                                </div>
                                <div className="flex gap-2">
                                  <Button onClick={saveField} disabled={busy} className="flex-1 lg:flex-none">
                                    Guardar
                                  </Button>
                                  <Button onClick={cancelEditField} disabled={busy} variant="outline" className="flex-1 lg:flex-none">
                                    Cancelar
                                  </Button>
                                </div>
                                <label className="lg:col-span-5 flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 py-2 text-sm text-slate-700">
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
                                  Mostrar este campo en la tarjeta/resumen de la entidad
                                </label>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-base font-semibold text-slate-900">{field.name}</h3>
                                    <span className={cn("rounded-full border px-2.5 py-1 text-xs", fieldTypeTone(field.field_type))}>
                                      {field.field_type}
                                    </span>
                                    <span className={cn("rounded-full border px-2.5 py-1 text-xs", analyticsTone(field.analytics_mode))}>
                                      {field.analytics_mode === "none" ? "sin analítica" : field.analytics_mode}
                                    </span>
                                    {field.show_in_card ? (
                                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700">
                                        visible en tarjeta
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-2 font-mono text-xs text-slate-500">{field.key}</div>
                                </div>
                                <div className="flex gap-2">
                                  <Button onClick={() => startEditField(field)} disabled={busy} variant="outline">
                                    Editar
                                  </Button>
                                  <Button onClick={() => void deleteField(field.id, field.name)} disabled={busy} variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800">
                                    Eliminar
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
