"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { MarkedDatePicker } from "@/components/marked-date-picker";

type Field = { id: string; name: string; key: string; field_type: "text" | "number" | "date" | "boolean" | "select"; options?: unknown };
type Entity = {
  id: string;
  name: string;
  usage_unit_id: string | null;
  usage_unit_name: string;
  usage_unit_visible: boolean;
  usage_unit_suggested_values?: string[];
  card_fields?: Array<{ name: string; value_text: string }>;
  fields: Field[];
  logged_days?: string[];
};

function todayDateInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fieldOptions(field: Field) {
  const raw = field.options;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : (raw && typeof raw === "object" && Array.isArray((raw as { values?: unknown }).values))
        ? (raw as { values: unknown[] }).values
        : (raw && typeof raw === "object" && Array.isArray((raw as { options?: unknown }).options))
          ? (raw as { options: unknown[] }).options
          : [];
  return list
    .map((v) => String(v ?? "").trim())
    .filter((v) => v.length > 0)
    .filter((v, i, arr) => arr.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
}

export default function FocusedUsageCapturePage() {
  const params = useParams<{ entityTypeName: string }>();
  const router = useRouter();
  const entityTypeName = String(params?.entityTypeName ?? "");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [typeLabel, setTypeLabel] = useState("");
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState("");
  const [viewMode, setViewMode] = useState<"single" | "pending">("pending");
  const [pendingSecondaryFilters, setPendingSecondaryFilters] = useState<string[]>([]);
  const [entitySearch, setEntitySearch] = useState("");
  const [value, setValue] = useState("");
  const [bulkDraftByEntity, setBulkDraftByEntity] = useState<Record<string, string>>({});
  const [bulkFieldDraftByEntity, setBulkFieldDraftByEntity] = useState<Record<string, Record<string, string>>>({});
  const [loggedOn, setLoggedOn] = useState(todayDateInput());
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>({});
  const [pendingPage, setPendingPage] = useState(1);
  const pendingPageSize = 10;

  const selected = useMemo(() => entities.find((e) => e.id === entityId) ?? null, [entities, entityId]);
  const alreadyLoggedForDay = Boolean(selected?.logged_days?.includes(loggedOn));
  const filteredEntities = useMemo(() => {
    const needle = entitySearch.trim().toLowerCase();
    if (!needle) return entities;
    return entities.filter((e) => e.name.toLowerCase().includes(needle));
  }, [entities, entitySearch]);
  const pendingEntities = useMemo(
    () => filteredEntities.filter((e) => !Boolean(e.logged_days?.includes(loggedOn))),
    [filteredEntities, loggedOn]
  );
  const pendingFieldColumns = useMemo(() => {
    const map = new Map<string, Field>();
    for (const e of pendingEntities) {
      for (const f of e.fields ?? []) {
        if (!map.has(f.id)) map.set(f.id, f);
      }
    }
    return Array.from(map.values());
  }, [pendingEntities]);
  const filteredPendingEntities = useMemo(() => {
    if (pendingSecondaryFilters.length === 0) return pendingEntities;
    return pendingEntities.filter((e) => {
      const values = new Set(
        (e.card_fields ?? [])
          .map((f) => String(f.value_text ?? "").trim())
          .filter((v) => v.length > 0)
      );
      return pendingSecondaryFilters.every((filterValue) => values.has(filterValue));
    });
  }, [pendingEntities, pendingSecondaryFilters]);
  const pendingSecondaryOptions = useMemo(() => {
    const source = filteredPendingEntities;
    const counts = new Map<string, number>();
    for (const e of source) {
      const values = new Set(
        (e.card_fields ?? [])
          .map((f) => String(f.value_text ?? "").trim())
          .filter((v) => v.length > 0)
      );
      for (const value of values) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [filteredPendingEntities]);
  const pendingTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredPendingEntities.length / pendingPageSize)),
    [filteredPendingEntities.length]
  );
  const safePendingPage = Math.min(pendingPage, pendingTotalPages);
  const pendingPageStart = (safePendingPage - 1) * pendingPageSize;
  const pendingPagedEntities = useMemo(
    () => filteredPendingEntities.slice(pendingPageStart, pendingPageStart + pendingPageSize),
    [filteredPendingEntities, pendingPageStart]
  );
  const orderedSelectedFields = useMemo(() => {
    const selectedFields = selected?.fields ?? [];
    if (selectedFields.length === 0) return [] as Field[];
    const pendingOrder = new Map<string, number>();
    pendingFieldColumns.forEach((f, idx) => pendingOrder.set(f.id, idx));
    return [...selectedFields].sort((a, b) => {
      const ai = pendingOrder.get(a.id);
      const bi = pendingOrder.get(b.id);
      const aScore = ai ?? Number.MAX_SAFE_INTEGER;
      const bScore = bi ?? Number.MAX_SAFE_INTEGER;
      if (aScore !== bScore) return aScore - bScore;
      return a.name.localeCompare(b.name);
    });
  }, [selected?.fields, pendingFieldColumns]);
  const fullyLoggedDates = useMemo(() => {
    if (entities.length === 0) return [];
    const counts = new Map<string, number>();
    for (const e of entities) {
      const uniqueDays = new Set((e.logged_days ?? []).map((d) => String(d)));
      for (const day of uniqueDays) {
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .filter(([, count]) => count === entities.length)
      .map(([day]) => day)
      .sort((a, b) => b.localeCompare(a));
  }, [entities]);
  const highlightedCalendarDates = useMemo(
    () => (viewMode === "single" ? (selected?.logged_days ?? []) : fullyLoggedDates),
    [viewMode, selected?.logged_days, fullyLoggedDates]
  );
  const chipDynamicFields = useMemo(
    () => orderedSelectedFields.filter((f) => fieldOptions(f).length > 0),
    [orderedSelectedFields]
  );
  const nonChipDynamicFields = useMemo(
    () => orderedSelectedFields.filter((f) => fieldOptions(f).length === 0),
    [orderedSelectedFields]
  );

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function load() {
    setLoading(true);
    setErrorMsg("");
    const token = await getTokenOrRedirect();
    if (!token) return;

    const moduleRes = await fetch("/api/me/module-access", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const moduleJson = await moduleRes.json().catch(() => ({}));
    if (!moduleRes.ok) {
      setErrorMsg(moduleJson.error || "No se pudo validar acceso al módulo.");
      setLoading(false);
      return;
    }
    const allowedModules = Array.isArray(moduleJson.allowed_modules)
      ? moduleJson.allowed_modules.map((m: unknown) => String(m))
      : [];
    if (!allowedModules.includes("usage_capture")) {
      router.replace("/app");
      return;
    }

    const qs = new URLSearchParams();
    qs.set("entity_type", entityTypeName);
    const ctxRes = await fetch(`/api/usage-capture/context?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const ctxJson = await ctxRes.json().catch(() => ({}));
    if (!ctxRes.ok) {
      setErrorMsg(ctxJson.error || "No se pudo cargar contexto de captura.");
      setLoading(false);
      return;
    }

    setTypeLabel(String(ctxJson.entity_type?.name ?? entityTypeName));
    const list = (ctxJson.entities ?? []) as Entity[];
    setEntities(list);
    if (!entityId && list[0]?.id) setEntityId(String(list[0].id));
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityTypeName]);

  useEffect(() => {
    setFieldDraft({});
  }, [entityId]);

  useEffect(() => {
    if (viewMode !== "single") return;
    if (!entityId || !loggedOn || !entityTypeName) return;

    let cancelled = false;
    async function loadExistingForDay() {
      setLoadingExisting(true);
      const token = await getTokenOrRedirect();
      if (!token || cancelled) return;

      const qs = new URLSearchParams();
      qs.set("entity_type", entityTypeName);
      qs.set("entity_id", entityId);
      qs.set("logged_on", loggedOn);
      const res = await fetch(`/api/usage-capture/log?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setLoadingExisting(false);
        setErrorMsg(json.error || "No se pudo cargar el registro del día.");
        return;
      }

      if (!json.exists || !json.usage_log) {
        setValue("");
        setFieldDraft({});
        setLoadingExisting(false);
        return;
      }

      const usageLog = json.usage_log as {
        value?: number | null;
        value_text?: string | null;
        field_values?: Array<{ usage_field_id?: string; value?: string | null }>;
      };
      const main = usageLog.value_text != null && String(usageLog.value_text).trim().length > 0
        ? String(usageLog.value_text)
        : (usageLog.value != null ? String(usageLog.value) : "");
      const nextFieldDraft: Record<string, string> = {};
      for (const row of usageLog.field_values ?? []) {
        const id = String(row.usage_field_id ?? "").trim();
        if (!id) continue;
        nextFieldDraft[id] = String(row.value ?? "");
      }
      setValue(main);
      setFieldDraft(nextFieldDraft);
      setLoadingExisting(false);
    }

    void loadExistingForDay();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, entityId, loggedOn, entityTypeName]);

  useEffect(() => {
    if (filteredEntities.length === 0) {
      setEntityId("");
      return;
    }
    if (!filteredEntities.some((e) => e.id === entityId)) {
      setEntityId(filteredEntities[0]?.id ?? "");
    }
  }, [entityId, filteredEntities]);
  useEffect(() => {
    setPendingSecondaryFilters([]);
  }, [loggedOn, entitySearch, entityTypeName]);
  useEffect(() => {
    setPendingPage(1);
  }, [loggedOn, entitySearch, entityTypeName, pendingSecondaryFilters]);
  useEffect(() => {
    if (pendingPage > pendingTotalPages) setPendingPage(pendingTotalPages);
  }, [pendingPage, pendingTotalPages]);

  async function save() {
    setBusy(true);
    setErrorMsg("");
    setOkMsg("");

    if (!entityTypeName) {
      setErrorMsg("Faltan parámetros de acceso.");
      setBusy(false);
      return;
    }
    if (!entityId) {
      setErrorMsg("Selecciona una entidad.");
      setBusy(false);
      return;
    }
    const rawValue = value.trim();

    const dynamic = (selected?.fields ?? [])
      .map((f) => {
        const raw = String(fieldDraft[f.id] ?? "").trim();
        if (!raw) return null;
        if (f.field_type === "number") return { usage_field_id: f.id, value: Number(raw) };
        if (f.field_type === "boolean") return { usage_field_id: f.id, value: raw === "true" };
        return { usage_field_id: f.id, value: raw };
      })
      .filter(Boolean) as Array<{ usage_field_id: string; value: string | number | boolean }>;

    const token = await getTokenOrRedirect();
    if (!token) return;
    const payload: Record<string, unknown> = {
      entity_type: entityTypeName,
      entity_id: entityId,
      logged_on: loggedOn || undefined,
    };
    const parse = parseRawValue(rawValue);
    if (parse.error) {
      setErrorMsg(parse.error);
      setBusy(false);
      return;
    }
    if (parse.value != null) payload.value = parse.value;
    if (parse.valueText) payload.value_text = parse.valueText;
    if (dynamic.length > 0) payload.field_values = dynamic;
    if (parse.value == null && !parse.valueText && dynamic.length === 0) {
      setErrorMsg("Ingresa un valor o completa al menos un campo.");
      setBusy(false);
      return;
    }

    const res = await fetch("/api/usage-capture/log", {
      method: alreadyLoggedForDay ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo guardar el registro.");
      setBusy(false);
      return;
    }

    if (!alreadyLoggedForDay) {
      setValue("");
      setFieldDraft({});
    }
    setEntities((prev) =>
      prev.map((e) => {
        if (e.id !== entityId) return e;
        const nextDays = new Set(e.logged_days ?? []);
        if (loggedOn) nextDays.add(loggedOn);
        return { ...e, logged_days: Array.from(nextDays).sort((a, b) => b.localeCompare(a)) };
      })
    );
    setOkMsg(alreadyLoggedForDay ? "Registro actualizado correctamente." : "Registro guardado correctamente.");
    setBusy(false);
  }

  function parseRawValue(rawValue: string): { value: number | null; valueText: string | null; error?: string } {
    const clean = String(rawValue ?? "").trim();
    if (!clean) return { value: null, valueText: null };
    const n = Number(clean);
    if (Number.isFinite(n)) {
      if (n < 0) return { value: null, valueText: null, error: "El valor de uso debe ser numérico y no negativo." };
      return { value: n, valueText: null };
    }
    return { value: null, valueText: clean };
  }

  async function saveBulkPending() {
    setBusy(true);
    setErrorMsg("");
    setOkMsg("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const candidates = pendingEntities
      .map((e) => {
        const rawValue = String(bulkDraftByEntity[e.id] ?? "").trim();
        const dynamic = (e.fields ?? [])
          .map((f) => {
            const raw = String(bulkFieldDraftByEntity[e.id]?.[f.id] ?? "").trim();
            if (!raw) return null;
            if (f.field_type === "number") return { usage_field_id: f.id, value: Number(raw) };
            if (f.field_type === "boolean") return { usage_field_id: f.id, value: raw === "true" };
            return { usage_field_id: f.id, value: raw };
          })
          .filter(Boolean) as Array<{ usage_field_id: string; value: string | number | boolean }>;
        return { entityId: e.id, rawValue, fieldValues: dynamic };
      })
      .filter((x) => x.rawValue.length > 0 || x.fieldValues.length > 0);
    if (candidates.length === 0) {
      setErrorMsg("Ingresa al menos un valor o campo para guardar en lote.");
      setBusy(false);
      return;
    }

    for (const c of candidates) {
      const parsed = parseRawValue(c.rawValue);
      if (parsed.error) {
        setErrorMsg(parsed.error);
        setBusy(false);
        return;
      }
      const payload: Record<string, unknown> = {
        entity_type: entityTypeName,
        entity_id: c.entityId,
        logged_on: loggedOn || undefined,
      };
      if (parsed.value != null) payload.value = parsed.value;
      if (parsed.valueText) payload.value_text = parsed.valueText;
      if (c.fieldValues.length > 0) payload.field_values = c.fieldValues;

      const res = await fetch("/api/usage-capture/log", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const name = entities.find((e) => e.id === c.entityId)?.name ?? c.entityId;
        setErrorMsg(`${name}: ${json.error || "No se pudo guardar el registro."}`);
        setBusy(false);
        return;
      }
    }

    const savedIds = new Set(candidates.map((c) => c.entityId));
    setEntities((prev) =>
      prev.map((e) => {
        if (!savedIds.has(e.id)) return e;
        const nextDays = new Set(e.logged_days ?? []);
        if (loggedOn) nextDays.add(loggedOn);
        return { ...e, logged_days: Array.from(nextDays).sort((a, b) => b.localeCompare(a)) };
      })
    );
    setBulkDraftByEntity((prev) => {
      const next = { ...prev };
      for (const id of savedIds) delete next[id];
      return next;
    });
    setBulkFieldDraftByEntity((prev) => {
      const next = { ...prev };
      for (const id of savedIds) delete next[id];
      return next;
    });
    setOkMsg(`Se guardaron ${savedIds.size} registros.`);
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-[1320px] space-y-4 px-4 py-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle>Ingreso de Uso Enfocado</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Tipo de entidad: <b>{typeLabel || entityTypeName || "—"}</b></p>
            </div>
            <Link href="/app/usage-capture">
              <Button variant="outline" size="sm">Volver</Button>
            </Link>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <p className="text-sm text-rose-600 whitespace-pre-wrap">{errorMsg}</p> : null}
      {okMsg ? <p className="text-sm text-emerald-700">{okMsg}</p> : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Formulario</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex justify-center py-6"><Loader label="Cargando..." /></div>
          ) : entities.length === 0 ? (
            <p className="text-sm text-slate-500">No hay entidades disponibles para este tipo.</p>
          ) : (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant={viewMode === "pending" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("pending")}
                  disabled={busy}
                >
                  Pendientes del día ({pendingEntities.length})
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "single" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("single")}
                  disabled={busy}
                >
                  Individual
                </Button>
              </div>

              <div className="grid items-end gap-2 md:grid-cols-[220px_minmax(220px,1fr)]">
                <MarkedDatePicker
                  value={loggedOn}
                  onChange={setLoggedOn}
                  highlightedDates={highlightedCalendarDates}
                  disabledDates={[]}
                  label="Fecha de registro"
                  disabled={busy}
                />

                <div className="grid gap-1">
                  <label className="text-xs text-slate-600">Buscar entidad</label>
                  <Input
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                    placeholder="Buscar entidad..."
                    disabled={busy}
                  />
                </div>
              </div>

              {viewMode === "single" ? (
                <>
                  {(() => {
                    const mainSuggestions = selected?.usage_unit_suggested_values ?? [];
                    if (mainSuggestions.length > 0) {
                      return (
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={entityId}
                            onChange={(e) => setEntityId(e.target.value)}
                            className="h-10 min-w-[260px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                            disabled={busy}
                          >
                            {filteredEntities.map((e) => (
                              <option key={e.id} value={e.id}>{e.name}</option>
                            ))}
                          </select>
                          <div className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap pb-1">
                            {mainSuggestions.map((opt) => {
                              const active = value.trim() === opt;
                              return (
                                  <button
                                    key={`main-${opt}`}
                                    type="button"
                                    disabled={busy || loadingExisting}
                                    onClick={() => setValue((prev) => (prev.trim() === opt ? "" : opt))}
                                    className={[
                                    "shrink-0 rounded-full border px-2 py-1 text-xs transition",
                                    active
                                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                                  ].join(" ")}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                          {chipDynamicFields.map((f) => (
                            <div key={`row-chip-${f.id}`} className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap pb-1">
                              <span className="shrink-0 text-xs text-slate-600">{f.name}</span>
                              {fieldOptions(f).map((opt) => {
                                const current = String(fieldDraft[f.id] ?? "");
                                const active = current === opt;
                                return (
                                  <button
                                    key={`${f.id}-${opt}`}
                                    type="button"
                                    disabled={busy || loadingExisting}
                                    onClick={() =>
                                      setFieldDraft((p) => ({
                                        ...p,
                                        [f.id]: current === opt ? "" : opt,
                                      }))
                                    }
                                    className={[
                                      "shrink-0 rounded-full border px-2 py-1 text-[10px] transition",
                                      active
                                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                                    ].join(" ")}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={entityId}
                          onChange={(e) => setEntityId(e.target.value)}
                          className="h-10 min-w-[260px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                          disabled={busy}
                        >
                          {filteredEntities.map((e) => (
                            <option key={e.id} value={e.id}>{e.name}</option>
                          ))}
                        </select>

                        <Input
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          placeholder={selected?.usage_unit_visible && selected?.usage_unit_name ? `Valor (${selected.usage_unit_name})` : "Valor"}
                          disabled={busy || loadingExisting}
                          className="min-w-[220px]"
                        />
                        {chipDynamicFields.map((f) => (
                          <div key={`row-chip-${f.id}`} className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap pb-1">
                            <span className="shrink-0 text-xs text-slate-600">{f.name}</span>
                            {fieldOptions(f).map((opt) => {
                              const current = String(fieldDraft[f.id] ?? "");
                              const active = current === opt;
                              return (
                                <button
                                  key={`${f.id}-${opt}`}
                                  type="button"
                                  disabled={busy || loadingExisting}
                                  onClick={() =>
                                    setFieldDraft((p) => ({
                                      ...p,
                                      [f.id]: current === opt ? "" : opt,
                                    }))
                                  }
                                  className={[
                                    "shrink-0 rounded-full border px-2 py-1 text-[10px] transition",
                                    active
                                      ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                      : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                                  ].join(" ")}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  {nonChipDynamicFields.length > 0 ? (
                    <div className="grid gap-2 rounded-xl border p-3 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] lg:items-center">
                      <div className="text-xs font-semibold text-slate-600">Campos dinámicos adicionales</div>
                      <div className="flex min-w-0 items-start gap-2 overflow-x-auto pb-1">
                        {nonChipDynamicFields.map((f) => (
                          <div key={f.id} className="grid min-w-[180px] gap-1">
                            <label className="truncate text-xs text-slate-600" title={f.name}>{f.name}</label>
                            {f.field_type === "boolean" ? (
                              <select
                                value={fieldDraft[f.id] ?? ""}
                                onChange={(e) => setFieldDraft((p) => ({ ...p, [f.id]: e.target.value }))}
                                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                                disabled={busy || loadingExisting}
                              >
                                <option value="">(vacío)</option>
                                <option value="true">Sí</option>
                                <option value="false">No</option>
                              </select>
                            ) : (
                              <Input
                                type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                                value={fieldDraft[f.id] ?? ""}
                                onChange={(e) => setFieldDraft((p) => ({ ...p, [f.id]: e.target.value }))}
                                disabled={busy || loadingExisting}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="text-[11px] text-slate-500">
                    {loadingExisting
                      ? "Cargando registro del día..."
                      : alreadyLoggedForDay
                      ? `Ya existe registro para ${loggedOn}. Puedes editarlo y guardar cambios.`
                      : ((selected?.logged_days ?? []).slice(0, 5).length > 0
                        ? `Días con registro: ${(selected?.logged_days ?? []).slice(0, 5).join(", ")}`
                        : "Sin registros previos.")}
                  </div>

                  <Button onClick={() => void save()} disabled={busy || loadingExisting} className="w-auto justify-self-start">
                    {busy ? "Guardando..." : alreadyLoggedForDay ? "Guardar cambios" : "Guardar registro"}
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-xs text-slate-500">
                    Entidades sin registro en {loggedOn}: <b>{pendingEntities.length}</b>
                  </div>
                  {pendingSecondaryOptions.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPendingSecondaryFilters([])}
                        className={[
                          "rounded-full border px-2.5 py-1 text-xs transition",
                          pendingSecondaryFilters.length === 0
                            ? "border-indigo-300 bg-indigo-100 text-indigo-800"
                            : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                        ].join(" ")}
                      >
                        Todos {pendingEntities.length}
                      </button>
                      {pendingSecondaryOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            setPendingSecondaryFilters((prev) =>
                              prev.includes(opt.value)
                                ? prev.filter((v) => v !== opt.value)
                                : [...prev, opt.value]
                            )
                          }
                          className={[
                            "rounded-full border px-2.5 py-1 text-xs transition",
                            pendingSecondaryFilters.includes(opt.value)
                              ? "border-indigo-300 bg-indigo-100 text-indigo-800"
                              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                          ].join(" ")}
                          title={opt.label}
                        >
                          <span className="max-w-[140px] truncate align-middle inline-block">{opt.label}</span>{" "}
                          <span className="font-semibold">{opt.count}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {filteredPendingEntities.length === 0 ? (
                    <p className="text-sm text-slate-500">No hay pendientes para la fecha seleccionada.</p>
                  ) : (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-[minmax(220px,1fr)_220px_minmax(480px,1fr)] items-center gap-2 px-1 py-0 text-sm font-semibold text-slate-700">
                        <div className="flex h-8 items-center">Entidad</div>
                        <div className="flex h-8 items-center">Valor</div>
                        <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-4">
                          {pendingFieldColumns.length > 0 ? (
                            pendingFieldColumns.map((f) => (
                              <div key={`head-${f.id}`} className="flex h-8 items-center text-sm font-semibold text-slate-700">
                                {f.name}
                              </div>
                            ))
                          ) : (
                            <div className="flex h-8 items-center text-sm font-semibold text-slate-400">—</div>
                          )}
                        </div>
                      </div>
                      {pendingPagedEntities.map((e) => (
                        <div key={e.id} className="grid grid-cols-[minmax(220px,1fr)_220px_minmax(480px,1fr)] items-center gap-2">
                          <div className="truncate text-sm text-slate-800" title={e.name}>{e.name}</div>
                          {(e.usage_unit_suggested_values ?? []).length > 0 ? (
                            <div className="flex gap-1 overflow-x-auto whitespace-nowrap pb-1">
                              {(e.usage_unit_suggested_values ?? []).map((opt) => {
                                const current = String(bulkDraftByEntity[e.id] ?? "").trim();
                                const active = current === opt;
                                return (
                                  <button
                                    key={`${e.id}-main-${opt}`}
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      setBulkDraftByEntity((prev) => ({
                                        ...prev,
                                        [e.id]: current === opt ? "" : opt,
                                      }))
                                    }
                                    className={[
                                      "shrink-0 rounded-full border px-2 py-1 text-[10px] transition",
                                      active
                                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                                    ].join(" ")}
                                  >
                                    {opt}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <Input
                              value={bulkDraftByEntity[e.id] ?? ""}
                              onChange={(ev) =>
                                setBulkDraftByEntity((prev) => ({
                                  ...prev,
                                  [e.id]: ev.target.value,
                                }))
                              }
                              placeholder={e.usage_unit_visible && e.usage_unit_name ? `Valor (${e.usage_unit_name})` : "Valor"}
                              disabled={busy}
                            />
                          )}
                          {(e.fields ?? []).length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-4">
                              {pendingFieldColumns.map((columnField) => {
                                const f = (e.fields ?? []).find((x) => x.id === columnField.id) ?? null;
                                if (!f) {
                                  return (
                                    <div key={`${e.id}-missing-${columnField.id}`} className="text-xs text-slate-400">
                                      —
                                    </div>
                                  );
                                }
                                if (fieldOptions(f).length > 0) {
                                  return (
                                    <div key={f.id} className="flex gap-1 overflow-x-auto whitespace-nowrap pb-1">
                                      {fieldOptions(f).map((opt) => {
                                        const current = String(bulkFieldDraftByEntity[e.id]?.[f.id] ?? "");
                                        const active = current === opt;
                                        return (
                                          <button
                                            key={`${e.id}-${f.id}-${opt}`}
                                            type="button"
                                            disabled={busy}
                                            onClick={() =>
                                              setBulkFieldDraftByEntity((prev) => ({
                                                ...prev,
                                                [e.id]: {
                                                  ...(prev[e.id] ?? {}),
                                                  [f.id]: current === opt ? "" : opt,
                                                },
                                              }))
                                            }
                                            className={[
                                              "shrink-0 rounded-full border px-2 py-1 text-[10px] transition",
                                              active
                                                ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                                                : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                                            ].join(" ")}
                                          >
                                            {opt}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  );
                                }
                                if (f.field_type === "boolean") {
                                  return (
                                    <select
                                      key={f.id}
                                      value={bulkFieldDraftByEntity[e.id]?.[f.id] ?? ""}
                                      onChange={(ev) =>
                                        setBulkFieldDraftByEntity((prev) => ({
                                          ...prev,
                                          [e.id]: { ...(prev[e.id] ?? {}), [f.id]: ev.target.value },
                                        }))
                                      }
                                      className="h-9 rounded-xl border border-slate-300 bg-white px-2 text-xs"
                                      disabled={busy}
                                    >
                                      <option value="">(vacío)</option>
                                      <option value="true">Sí</option>
                                      <option value="false">No</option>
                                    </select>
                                  );
                                }
                                return (
                                  <Input
                                    key={f.id}
                                    type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                                    value={bulkFieldDraftByEntity[e.id]?.[f.id] ?? ""}
                                    onChange={(ev) =>
                                      setBulkFieldDraftByEntity((prev) => ({
                                        ...prev,
                                        [e.id]: { ...(prev[e.id] ?? {}), [f.id]: ev.target.value },
                                      }))
                                    }
                                    disabled={busy}
                                    className="h-9 text-xs"
                                  />
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {filteredPendingEntities.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <div>
                        Mostrando {pendingPageStart + 1}-{Math.min(pendingPageStart + pendingPageSize, filteredPendingEntities.length)} de{" "}
                        {filteredPendingEntities.length}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPendingPage(1)}
                          disabled={safePendingPage <= 1}
                          className="rounded border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          «
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
                          disabled={safePendingPage <= 1}
                          className="rounded border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          ‹
                        </button>
                        <span className="px-2">
                          Página {safePendingPage} de {pendingTotalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setPendingPage((p) => Math.min(pendingTotalPages, p + 1))}
                          disabled={safePendingPage >= pendingTotalPages}
                          className="rounded border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          ›
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingPage(pendingTotalPages)}
                          disabled={safePendingPage >= pendingTotalPages}
                          className="rounded border border-slate-300 bg-white px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          »
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="text-[11px] text-slate-500">
                    En modo lote puedes cargar valor principal y campos dinámicos en formato compacto.
                  </div>
                  <Button onClick={() => void saveBulkPending()} disabled={busy || filteredPendingEntities.length === 0} className="w-auto justify-self-start">
                    {busy ? "Guardando..." : "Guardar lote"}
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
