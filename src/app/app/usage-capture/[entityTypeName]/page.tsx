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
  search_values?: string[];
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

function normalizeSearchText(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export default function FocusedUsageCapturePage() {
  const params = useParams<{ entityTypeName: string }>();
  const router = useRouter();
  const entityTypeName = String(params?.entityTypeName ?? "");

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [typeLabel, setTypeLabel] = useState("");
  const [entities, setEntities] = useState<Entity[]>([]);
  const [pendingSecondaryFilters, setPendingSecondaryFilters] = useState<string[]>([]);
  const [pendingSecondaryMenuOpen, setPendingSecondaryMenuOpen] = useState(false);
  const [pendingSecondarySearch, setPendingSecondarySearch] = useState("");
  const [entitySearch, setEntitySearch] = useState("");
  const [bulkDraftByEntity, setBulkDraftByEntity] = useState<Record<string, string>>({});
  const [bulkFieldDraftByEntity, setBulkFieldDraftByEntity] = useState<Record<string, Record<string, string>>>({});
  const [loggedOn, setLoggedOn] = useState(todayDateInput());
  const [pendingPage, setPendingPage] = useState(1);
  const pendingPageSize = 10;

  const filteredEntities = useMemo(() => {
    const needle = entitySearch.trim().toLowerCase();
    const needleNorm = normalizeSearchText(entitySearch);
    if (!needle) return entities;
    return entities.filter((e) => {
      const candidates = [
        e.name,
        ...(e.card_fields ?? []).flatMap((f) => [String(f.name ?? ""), String(f.value_text ?? "")]),
        ...(e.search_values ?? []).map((v) => String(v ?? "")),
      ];
      return candidates.some((candidate) => {
        const raw = candidate.toLowerCase();
        if (raw.includes(needle)) return true;
        return needleNorm.length > 0 && normalizeSearchText(candidate).includes(needleNorm);
      });
    });
  }, [entities, entitySearch]);
  const searchDebugMatches = useMemo(() => {
    const needle = entitySearch.trim();
    if (!needle) return [] as Array<{ entityName: string; values: string[]; pendingForDay: boolean; passesSecondaryFilters: boolean }>;
    const needleNorm = normalizeSearchText(needle);
    const selectedSecondary = new Set(pendingSecondaryFilters);
    return entities
      .map((e) => {
        const fieldValues = [
          String(e.name ?? ""),
          ...(e.card_fields ?? []).flatMap((f) => [String(f.name ?? ""), String(f.value_text ?? "")]),
          ...(e.search_values ?? []).map((v) => String(v ?? "")),
        ]
          .map((v) => v.trim())
          .filter((v) => v.length > 0);

        const dedup = Array.from(new Set(fieldValues));
        const matches = dedup.filter((value) => {
          const raw = value.toLowerCase();
          if (raw.includes(needle.toLowerCase())) return true;
          return needleNorm.length > 0 && normalizeSearchText(value).includes(needleNorm);
        });
        if (matches.length === 0) return null;
        const pendingForDay = !Boolean(e.logged_days?.includes(loggedOn));
        const cardValueSet = new Set(
          (e.card_fields ?? [])
            .map((f) => String(f.value_text ?? "").trim())
            .filter((v) => v.length > 0)
        );
        const passesSecondaryFilters = selectedSecondary.size === 0
          ? true
          : Array.from(selectedSecondary).every((filterValue) => cardValueSet.has(filterValue));
        return { entityName: e.name, values: matches.slice(0, 8), pendingForDay, passesSecondaryFilters };
      })
      .filter(Boolean)
      .slice(0, 16) as Array<{ entityName: string; values: string[]; pendingForDay: boolean; passesSecondaryFilters: boolean }>;
  }, [entities, entitySearch, loggedOn, pendingSecondaryFilters]);
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
  const pendingSecondaryTopOptions = useMemo(
    () => pendingSecondaryOptions.slice(0, 8),
    [pendingSecondaryOptions]
  );
  const pendingSecondaryFilteredOptions = useMemo(() => {
    const needle = pendingSecondarySearch.trim().toLowerCase();
    if (!needle) return pendingSecondaryOptions;
    return pendingSecondaryOptions.filter((opt) => opt.label.toLowerCase().includes(needle));
  }, [pendingSecondaryOptions, pendingSecondarySearch]);
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
  const highlightedCalendarDates = fullyLoggedDates;

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
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityTypeName]);

  useEffect(() => {
    setPendingSecondaryFilters([]);
  }, [loggedOn, entitySearch, entityTypeName]);
  useEffect(() => {
    setPendingSecondaryMenuOpen(false);
    setPendingSecondarySearch("");
  }, [loggedOn, entitySearch, entityTypeName]);
  useEffect(() => {
    setPendingPage(1);
  }, [loggedOn, entitySearch, entityTypeName, pendingSecondaryFilters]);
  useEffect(() => {
    if (pendingPage > pendingTotalPages) setPendingPage(pendingTotalPages);
  }, [pendingPage, pendingTotalPages]);

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
    <main className="mx-auto w-full max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="app-page-title">Ingreso de Uso Enfocado</CardTitle>
              <p className="app-page-subtitle">Tipo de entidad: <b>{typeLabel || entityTypeName || "—"}</b></p>
            </div>
            <Link href="/app/usage-capture">
              <Button variant="outline" size="sm">Volver</Button>
            </Link>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <div className="app-alert app-alert-error whitespace-pre-wrap">{errorMsg}</div> : null}
      {okMsg ? <div className="app-alert app-alert-success">{okMsg}</div> : null}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Pendientes del día ({pendingEntities.length})</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex justify-center py-6"><Loader label="Cargando..." /></div>
          ) : entities.length === 0 ? (
            <p className="app-empty">No hay entidades disponibles para este tipo.</p>
          ) : (
            <div className="grid gap-3">
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
                  <label className="text-xs text-[var(--muted-foreground)]">Buscar entidad</label>
                  <Input
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                    placeholder="Buscar entidad..."
                    disabled={busy}
                  />
                  {entitySearch.trim().length > 0 ? (
                    <div className="max-h-44 overflow-auto rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--muted)]/80 p-2 text-xs">
                      <div className="mb-1 font-semibold text-[var(--foreground)]">Posibles coincidencias en campos de entidad</div>
                      <div className="mb-2 text-[11px] text-[var(--muted-foreground)]">
                        Coincidencias: {searchDebugMatches.length} · Pendientes visibles: {filteredPendingEntities.length} · Con registro ese día: {searchDebugMatches.filter((r) => !r.pendingForDay).length}
                      </div>
                      {searchDebugMatches.length === 0 ? (
                        <div className="text-[var(--muted-foreground)]">Sin coincidencias en campos.</div>
                      ) : (
                        <div className="grid gap-1">
                          {searchDebugMatches.map((row) => (
                            <div key={`${row.entityName}-${row.values.join("|")}`} className="rounded-[8px] border border-[color:var(--border)] bg-[var(--card)] px-2 py-1">
                              <div className="truncate font-medium text-[var(--foreground)]">
                                {row.entityName}
                                {!row.pendingForDay ? <span className="ml-2 text-[10px] font-normal text-amber-700">(ya registrado en la fecha)</span> : null}
                                {row.pendingForDay && !row.passesSecondaryFilters ? <span className="ml-2 text-[10px] font-normal text-indigo-700">(filtrado por chips secundarios)</span> : null}
                              </div>
                              <div className="truncate text-[var(--muted-foreground)]">{row.values.join(" · ")}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <>
                  <div className="text-xs text-[var(--muted-foreground)]">
                    Entidades sin registro en {loggedOn}: <b>{pendingEntities.length}</b>
                  </div>
                  {pendingSecondaryOptions.length > 0 ? (
                    <div className="grid gap-2">
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
                        {pendingSecondaryTopOptions.map((opt) => (
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
                        {pendingSecondaryOptions.length > pendingSecondaryTopOptions.length ? (
                          <button
                            type="button"
                            onClick={() => setPendingSecondaryMenuOpen((v) => !v)}
                            className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-700 transition hover:bg-slate-50"
                          >
                            {pendingSecondaryMenuOpen ? "Ocultar" : `+${pendingSecondaryOptions.length - pendingSecondaryTopOptions.length} más`}
                          </button>
                        ) : null}
                      </div>

                      {pendingSecondaryFilters.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {pendingSecondaryFilters.map((value) => (
                            <button
                              key={`active-${value}`}
                              type="button"
                              onClick={() =>
                                setPendingSecondaryFilters((prev) => prev.filter((v) => v !== value))
                              }
                              className="rounded-full border border-indigo-300 bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-800"
                              title={`Quitar filtro ${value}`}
                            >
                              {value} ×
                            </button>
                          ))}
                        </div>
                      ) : null}

                      {pendingSecondaryMenuOpen ? (
                        <div className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--card)] p-2">
                          <div className="grid gap-2">
                            <Input
                              value={pendingSecondarySearch}
                              onChange={(e) => setPendingSecondarySearch(e.target.value)}
                              placeholder="Buscar filtro secundario..."
                              disabled={busy}
                            />
                            <div className="max-h-44 overflow-auto">
                              <div className="flex flex-wrap gap-2">
                                {pendingSecondaryFilteredOptions.map((opt) => (
                                  <button
                                    key={`more-${opt.value}`}
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
                                    <span className="max-w-[200px] truncate align-middle inline-block">{opt.label}</span>{" "}
                                    <span className="font-semibold">{opt.count}</span>
                                  </button>
                                ))}
                                {pendingSecondaryFilteredOptions.length === 0 ? (
                                  <span className="text-xs text-[var(--muted-foreground)]">Sin coincidencias.</span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {filteredPendingEntities.length === 0 ? (
                    <p className="app-empty">No hay pendientes para la fecha seleccionada.</p>
                  ) : (
                    <div className="grid gap-2">
                      <div className="hidden grid-cols-[minmax(220px,1fr)_220px_minmax(480px,1fr)] items-center gap-2 px-1 py-0 text-sm font-semibold text-slate-700 lg:grid">
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
                        <div
                          key={e.id}
                          className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_220px_minmax(480px,1fr)] lg:items-center lg:gap-2 lg:border-0 lg:p-0"
                        >
                          <div className="min-w-0 truncate text-sm text-slate-800" title={e.name}>
                            {e.name}
                          </div>
                          <div className="min-w-0">
                            {(e.usage_unit_suggested_values ?? []).length > 0 ? (
                              <div className="flex flex-wrap gap-1">
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
                                        "rounded-full border px-2 py-1 text-[10px] transition",
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
                          </div>
                          {(e.fields ?? []).length === 0 ? (
                            <span className="text-xs text-slate-400 sm:col-span-2 lg:col-auto">—</span>
                          ) : (
                            <div className="grid grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-2 lg:col-auto lg:gap-1 xl:grid-cols-4">
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
                                    <div key={f.id} className="min-w-0">
                                      <div className="flex flex-wrap gap-1 pb-1">
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
                                                "rounded-full border px-2 py-1 text-[10px] transition",
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
                                    </div>
                                  );
                                }
                                if (f.field_type === "boolean") {
                                  return (
                                    <div key={f.id} className="min-w-0">
                                      <select
                                        value={bulkFieldDraftByEntity[e.id]?.[f.id] ?? ""}
                                        onChange={(ev) =>
                                          setBulkFieldDraftByEntity((prev) => ({
                                            ...prev,
                                            [e.id]: { ...(prev[e.id] ?? {}), [f.id]: ev.target.value },
                                          }))
                                        }
                                        className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
                                        disabled={busy}
                                      >
                                        <option value="">(vacío)</option>
                                        <option value="true">Sí</option>
                                        <option value="false">No</option>
                                      </select>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={f.id} className="min-w-0">
                                    <Input
                                      type={f.field_type === "number" ? "number" : f.field_type === "date" ? "date" : "text"}
                                      value={bulkFieldDraftByEntity[e.id]?.[f.id] ?? ""}
                                      onChange={(ev) =>
                                        setBulkFieldDraftByEntity((prev) => ({
                                          ...prev,
                                          [e.id]: { ...(prev[e.id] ?? {}), [f.id]: ev.target.value },
                                        }))
                                      }
                                      disabled={busy}
                                      className="h-[var(--control-h)] text-[13px] sm:text-sm"
                                    />
                                  </div>
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
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
