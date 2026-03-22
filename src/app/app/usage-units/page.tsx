"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type UsageUnit = {
  id: string;
  name: string;
  is_active: boolean;
  show_in_usage_records: boolean;
  suggested_values?: string[];
  created_at: string;
};
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
  options_text?: string;
};

function normalizeOptions(raw: unknown) {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : raw && typeof raw === "object" && Array.isArray((raw as { values?: unknown }).values)
        ? (raw as { values: unknown[] }).values
        : raw && typeof raw === "object" && Array.isArray((raw as { options?: unknown }).options)
          ? (raw as { options: unknown[] }).options
          : [];
  return list
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 0)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
}

function toSlugKey(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/[\s_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function fieldTypeTone(fieldType: UsageField["field_type"]) {
  if (fieldType === "number") return "border-sky-200 bg-sky-50 text-sky-700";
  if (fieldType === "date") return "border-violet-200 bg-violet-50 text-violet-700";
  if (fieldType === "boolean") return "border-amber-200 bg-amber-50 text-amber-700";
  if (fieldType === "select") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function normalizeSuggestedValuesDraft(raw: string) {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value, index, arr) => arr.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index);
}

function buildSuggestedPreviewPalette(values: string[]) {
  const base = [
    { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
    { badge: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
    { badge: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
    { badge: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-500" },
    { badge: "border-violet-200 bg-violet-50 text-violet-700", dot: "bg-violet-500" },
    { badge: "border-orange-200 bg-orange-50 text-orange-700", dot: "bg-orange-500" },
    { badge: "border-teal-200 bg-teal-50 text-teal-700", dot: "bg-teal-500" },
    { badge: "border-indigo-200 bg-indigo-50 text-indigo-700", dot: "bg-indigo-500" },
    { badge: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700", dot: "bg-fuchsia-500" },
    { badge: "border-lime-200 bg-lime-50 text-lime-700", dot: "bg-lime-500" },
  ];

  return values.map((value, index) => ({
    value,
    ...base[index % base.length],
  }));
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

export default function UsageUnitsPage() {
  const router = useRouter();

  const [units, setUnits] = useState<UsageUnit[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = useMemo(() => units.find((u) => u.id === selectedId) ?? null, [units, selectedId]);

  const [fields, setFields] = useState<UsageField[]>([]);
  const [newUnitName, setNewUnitName] = useState("");
  const [selectedSuggestedValuesDraft, setSelectedSuggestedValuesDraft] = useState("");
  const [editingUnitId, setEditingUnitId] = useState<string>("");
  const [editUnitName, setEditUnitName] = useState("");
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<UsageField["field_type"]>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [editingFieldId, setEditingFieldId] = useState<string>("");
  const [fieldDraft, setFieldDraft] = useState<FieldDraft | null>(null);
  const [unitSearch, setUnitSearch] = useState("");

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  const filteredUnits = useMemo(() => {
    const needle = unitSearch.trim().toLowerCase();
    if (!needle) return units;
    return units.filter((unit) => unit.name.toLowerCase().includes(needle));
  }, [units, unitSearch]);
  const visibleCount = useMemo(
    () => units.filter((unit) => unit.show_in_usage_records !== false).length,
    [units]
  );
  const suggestedValueCount = useMemo(
    () => units.reduce((total, unit) => total + (unit.suggested_values?.length ?? 0), 0),
    [units]
  );
  const suggestedValuesPreview = useMemo(
    () => buildSuggestedPreviewPalette(normalizeSuggestedValuesDraft(selectedSuggestedValuesDraft)),
    [selectedSuggestedValuesDraft]
  );

  useEffect(() => {
    void loadUnits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) void loadFields(selectedId);
    else setFields([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    setSelectedSuggestedValuesDraft((selected?.suggested_values ?? []).join(", "));
  }, [selected?.id, selected?.suggested_values]);

  async function loadUnits() {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/usage-units", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar las unidades de uso");
      return;
    }
    const list = Array.isArray(json.usage_units) ? (json.usage_units as UsageUnit[]) : [];
    setUnits(list);
    if (!selectedId && list.length) {
      setSelectedId(list[0].id);
    }
    if (selectedId && !list.some((unit) => unit.id === selectedId)) {
      setSelectedId(list[0]?.id ?? "");
    }
  }

  async function createUnit() {
    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

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

  async function deleteUnit(unitId: string, unitName: string) {
    const ok = window.confirm(`¿Eliminar la unidad "${unitName}"?`);
    if (!ok) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (editingUnitId === unitId) cancelEditUnit();
    await loadUnits();
    setBusy(false);
  }

  function startEditUnit(unit: UsageUnit) {
    setEditingUnitId(unit.id);
    setEditUnitName(unit.name);
    setMsg("");
  }

  function cancelEditUnit() {
    setEditingUnitId("");
    setEditUnitName("");
    setMsg("");
  }

  async function saveUnit() {
    if (!editingUnitId) return;
    const name = editUnitName.trim();
    if (!name) {
      setMsg("Nombre requerido");
      return;
    }

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/usage-units?id=${encodeURIComponent(editingUnitId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo actualizar la unidad");
      setBusy(false);
      return;
    }

    cancelEditUnit();
    await loadUnits();
    setBusy(false);
  }

  async function saveSelectedSuggestedValues() {
    if (!selectedId) return;
    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

    const suggestedValues = selectedSuggestedValuesDraft
      .split(",")
      .map((v) => v.trim())
      .filter((v, i, arr) => v && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);

    const res = await fetch(`/api/usage-units?id=${encodeURIComponent(selectedId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ suggested_values: suggestedValues }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron guardar los valores sugeridos");
      setBusy(false);
      return;
    }

    setUnits((prev) =>
      prev.map((unit) => (unit.id === selectedId ? { ...unit, suggested_values: suggestedValues } : unit))
    );
    setBusy(false);
  }

  async function setUnitVisibility(unitId: string, showInUsageRecords: boolean) {
    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/usage-units?id=${encodeURIComponent(unitId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ show_in_usage_records: showInUsageRecords }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo actualizar visibilidad de la unidad");
      setBusy(false);
      return;
    }

    setUnits((prev) =>
      prev.map((unit) =>
        unit.id === unitId ? { ...unit, show_in_usage_records: showInUsageRecords } : unit
      )
    );
    setBusy(false);
  }

  async function loadFields(usageUnitId: string) {
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/usage-fields?usage_unit_id=${encodeURIComponent(usageUnitId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar campos");
      return;
    }
    setFields(Array.isArray(json.usage_fields) ? (json.usage_fields as UsageField[]) : []);
  }

  async function createField() {
    if (!selectedId) {
      setMsg("Selecciona una unidad primero");
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
    const options = newFieldOptions
      .split(",")
      .map((v) => v.trim())
      .filter((v, i, arr) => v && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
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
        options: options.length > 0 ? options : null,
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
    setNewFieldOptions("");
    await loadFields(selectedId);
    setBusy(false);
  }

  function startEditField(field: UsageField) {
    setEditingFieldId(field.id);
    setFieldDraft({
      name: field.name,
      key: field.key,
      field_type: field.field_type,
      options_text: normalizeOptions(field.options).join(", "),
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

    const normalizedKey = toSlugKey(String(fieldDraft.key ?? "").trim()) || toSlugKey(fieldDraft.name);

    const res = await fetch(`/api/usage-fields?id=${encodeURIComponent(editingFieldId)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...fieldDraft,
        key: normalizedKey,
        options: String(fieldDraft.options_text ?? "")
          .split(",")
          .map((v) => v.trim())
          .filter((v, i, arr) => v && arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i),
      }),
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
    const ok = window.confirm(`¿Eliminar el campo "${fieldName}"?`);
    if (!ok) return;

    setBusy(true);
    setMsg("");
    const token = await getTokenOrRedirect(router);
    if (!token) {
      setBusy(false);
      return;
    }

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
                Unidades de uso
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Modelo de captura por unidad
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Organiza las unidades, su visibilidad en registros y los campos personalizados de cada una.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Unidades</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{units.length}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Visibles</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{visibleCount}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Valores sugeridos</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{suggestedValueCount}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {msg ? (
        <div className={cn(
          "rounded-2xl border px-4 py-3 text-sm",
          msg.toLowerCase().includes("no se")
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-emerald-200 bg-emerald-50 text-emerald-700"
        )}>
          {msg}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Nueva unidad</div>
              <CardTitle className="text-base sm:text-lg">Crear unidad de uso</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={newUnitName}
                onChange={(e) => setNewUnitName(e.target.value)}
                placeholder="Ej: Horas, Km, Ciclos"
                disabled={busy}
              />
              <Button onClick={createUnit} disabled={busy || !newUnitName.trim()} className="w-full">
                Crear unidad
              </Button>
            </CardContent>
          </Card>

          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Navegación</div>
              <CardTitle className="text-base sm:text-lg">Unidades disponibles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={unitSearch}
                onChange={(e) => setUnitSearch(e.target.value)}
                placeholder="Buscar unidad..."
                disabled={busy}
              />

              {filteredUnits.length === 0 ? (
                <p className="text-sm text-slate-500">No hay unidades para mostrar.</p>
              ) : (
                <div className="grid gap-2">
                  {filteredUnits.map((unit) => {
                    const active = unit.id === selectedId;
                    const isEditing = editingUnitId === unit.id;

                    if (isEditing) {
                      return (
                        <div key={unit.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="grid gap-3">
                            <Input
                              value={editUnitName}
                              onChange={(e) => setEditUnitName(e.target.value)}
                              disabled={busy}
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => void saveUnit()} disabled={busy}>
                                Guardar
                              </Button>
                              <Button variant="outline" size="sm" onClick={cancelEditUnit} disabled={busy}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={unit.id}
                        className={cn(
                          "rounded-2xl border px-3 py-3 transition-colors",
                          active
                            ? "border-slate-300 bg-slate-900 text-white"
                            : "border-slate-200 bg-white text-slate-800"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedId(unit.id)}
                          disabled={busy}
                          className="w-full text-left"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{unit.name}</div>
                              <div className={cn("mt-1 text-xs", active ? "text-white/70" : "text-slate-500")}>
                                {(unit.suggested_values ?? []).length} valores sugeridos
                              </div>
                            </div>
                            <Badge
                              variant="secondary"
                              className={cn(
                                "border",
                                active
                                  ? "border-white/20 bg-white/10 text-white"
                                  : unit.show_in_usage_records !== false
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-slate-200 bg-slate-100 text-slate-600"
                              )}
                            >
                              {unit.show_in_usage_records !== false ? "Visible" : "Oculta"}
                            </Badge>
                          </div>
                        </button>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant={active ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => startEditUnit(unit)}
                            disabled={busy}
                          >
                            Editar
                          </Button>
                          <Button
                            variant={active ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => void setUnitVisibility(unit.id, !(unit.show_in_usage_records !== false))}
                            disabled={busy}
                          >
                            {unit.show_in_usage_records !== false ? "Ocultar" : "Mostrar"}
                          </Button>
                          <Button
                            variant={active ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => void deleteUnit(unit.id, unit.name)}
                            disabled={busy}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </div>
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
                Selecciona una unidad para gestionar su captura.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Unidad seleccionada</div>
                      <CardTitle className="text-lg sm:text-xl">{selected.name}</CardTitle>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                        {fields.length} campos
                      </Badge>
                      <Badge
                        variant="secondary"
                        className={selected.show_in_usage_records !== false ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}
                      >
                        {selected.show_in_usage_records !== false ? "Visible en registros" : "Oculta en registros"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="grid gap-3 pt-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                      Valores sugeridos
                    </label>
                    <Input
                      value={selectedSuggestedValuesDraft}
                      onChange={(e) => setSelectedSuggestedValuesDraft(e.target.value)}
                      placeholder="Ej: P, D, N/A"
                      disabled={busy}
                    />
                    {suggestedValuesPreview.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {suggestedValuesPreview.map((item, index) => (
                          <div
                            key={`${item.value}-${index}`}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
                              item.badge
                            )}
                          >
                            <span className={cn("h-2.5 w-2.5 rounded-full", item.dot)} />
                            <span>{item.value}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-slate-500">
                      Se reutilizan como ayudas rápidas cuando el registro depende de esta unidad. La vista previa respeta el mismo orden de colores usado en el reporte cronológico.
                    </p>
                  </div>
                  <Button onClick={() => void saveSelectedSuggestedValues()} disabled={busy}>
                    Guardar sugeridos
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
                <CardHeader className="pb-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Nuevo campo</div>
                  <CardTitle className="text-base sm:text-lg">Agregar campo de captura</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_180px_minmax(220px,1fr)_auto] xl:items-end">
                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nombre</label>
                    <Input
                      value={newFieldName}
                      onChange={(e) => setNewFieldName(e.target.value)}
                      placeholder="Ej: Operador, Turno, Inspector"
                      disabled={busy}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Tipo</label>
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value as UsageField["field_type"])}
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
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Opciones</label>
                    <Input
                      value={newFieldOptions}
                      onChange={(e) => setNewFieldOptions(e.target.value)}
                      placeholder="Solo para selección"
                      disabled={busy}
                    />
                  </div>

                  <Button onClick={createField} disabled={busy || !newFieldName.trim()}>
                    Agregar campo
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
                <CardHeader className="pb-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Estructura</div>
                  <CardTitle className="text-base sm:text-lg">Campos configurados</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {fields.length === 0 ? (
                    <p className="text-sm text-slate-500">Esta unidad aún no tiene campos.</p>
                  ) : (
                    fields.map((field) => {
                      const isEditing = editingFieldId === field.id;
                      const options = normalizeOptions(field.options);

                      return (
                        <div
                          key={field.id}
                          className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.45)]"
                        >
                          {!isEditing ? (
                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-base font-semibold text-slate-900">{field.name}</div>
                                  <Badge variant="secondary" className={cn("border", fieldTypeTone(field.field_type))}>
                                    {field.field_type}
                                  </Badge>
                                </div>
                                <div className="font-mono text-xs text-slate-500">{field.key}</div>
                                <div className="text-xs text-slate-500">
                                  {options.length > 0 ? `Opciones: ${options.join(", ")}` : "Sin opciones predefinidas"}
                                </div>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" onClick={() => startEditField(field)} disabled={busy}>
                                  Editar
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void deleteField(field.id, field.name)}
                                  disabled={busy}
                                >
                                  Eliminar
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-4">
                              <div>
                                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Edición</div>
                                <div className="mt-1 text-base font-semibold text-slate-900">Actualizar campo</div>
                              </div>

                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.2fr)_minmax(180px,0.8fr)_180px_minmax(220px,1fr)]">
                                <div className="grid gap-2">
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nombre</label>
                                  <Input
                                    value={fieldDraft?.name ?? ""}
                                    onChange={(e) =>
                                      setFieldDraft((prev) => {
                                        if (!prev) return prev;
                                        const nextName = e.target.value;
                                        const nextNameSlug = toSlugKey(nextName);
                                        const currentNameSlug = toSlugKey(prev.name);
                                        const shouldSyncKey = prev.key === currentNameSlug;
                                        return {
                                          ...prev,
                                          name: nextName,
                                          key: shouldSyncKey ? nextNameSlug : prev.key,
                                        };
                                      })
                                    }
                                    disabled={busy}
                                  />
                                </div>

                                <div className="grid gap-2">
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Key</label>
                                  <Input
                                    value={fieldDraft?.key ?? ""}
                                    onChange={(e) =>
                                      setFieldDraft((prev) => (prev ? { ...prev, key: e.target.value } : prev))
                                    }
                                    disabled={busy}
                                    className="font-mono"
                                  />
                                </div>

                                <div className="grid gap-2">
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Tipo</label>
                                  <select
                                    value={fieldDraft?.field_type ?? "text"}
                                    onChange={(e) =>
                                      setFieldDraft((prev) =>
                                        prev ? { ...prev, field_type: e.target.value as UsageField["field_type"] } : prev
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
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Opciones</label>
                                  <Input
                                    value={fieldDraft?.options_text ?? ""}
                                    onChange={(e) =>
                                      setFieldDraft((prev) => (prev ? { ...prev, options_text: e.target.value } : prev))
                                    }
                                    disabled={busy}
                                    placeholder="Opciones separadas por coma"
                                  />
                                </div>
                              </div>

                              <div className="flex flex-wrap justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={cancelEditField} disabled={busy}>
                                  Cancelar
                                </Button>
                                <Button size="sm" onClick={saveField} disabled={busy}>
                                  Guardar cambios
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
            </>
          )}
        </div>
      </section>
    </main>
  );
}
