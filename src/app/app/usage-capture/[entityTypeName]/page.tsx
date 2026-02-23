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

type Field = { id: string; name: string; key: string; field_type: "text" | "number" | "date" | "boolean" | "select" };
type Entity = {
  id: string;
  name: string;
  usage_unit_id: string | null;
  usage_unit_name: string;
  usage_unit_visible: boolean;
  fields: Field[];
  logged_days?: string[];
};

function todayDateInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
  const [entityId, setEntityId] = useState("");
  const [viewMode, setViewMode] = useState<"single" | "pending">("single");
  const [entitySearch, setEntitySearch] = useState("");
  const [value, setValue] = useState("");
  const [bulkDraftByEntity, setBulkDraftByEntity] = useState<Record<string, string>>({});
  const [bulkFieldDraftByEntity, setBulkFieldDraftByEntity] = useState<Record<string, Record<string, string>>>({});
  const [loggedOn, setLoggedOn] = useState(todayDateInput());
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>({});

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
    if (filteredEntities.length === 0) {
      setEntityId("");
      return;
    }
    if (!filteredEntities.some((e) => e.id === entityId)) {
      setEntityId(filteredEntities[0]?.id ?? "");
    }
  }, [entityId, filteredEntities]);

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
    if (loggedOn && alreadyLoggedForDay) {
      setErrorMsg("Ya existe un registro para esta entidad en la fecha seleccionada.");
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
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo guardar el registro.");
      setBusy(false);
      return;
    }

    setValue("");
    setFieldDraft({});
    setEntities((prev) =>
      prev.map((e) => {
        if (e.id !== entityId) return e;
        const nextDays = new Set(e.logged_days ?? []);
        if (loggedOn) nextDays.add(loggedOn);
        return { ...e, logged_days: Array.from(nextDays).sort((a, b) => b.localeCompare(a)) };
      })
    );
    setOkMsg("Registro guardado correctamente.");
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
    <main className="mx-auto max-w-[840px] space-y-4 px-4 py-6">
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
                  variant={viewMode === "single" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("single")}
                  disabled={busy}
                >
                  Individual
                </Button>
                <Button
                  type="button"
                  variant={viewMode === "pending" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setViewMode("pending")}
                  disabled={busy}
                >
                  Pendientes del día ({pendingEntities.length})
                </Button>
              </div>

              <div className="grid items-end gap-2 md:grid-cols-[220px_minmax(220px,1fr)]">
                <MarkedDatePicker
                  value={loggedOn}
                  onChange={setLoggedOn}
                  highlightedDates={selected?.logged_days ?? []}
                  disabledDates={selected?.logged_days ?? []}
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
                  <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_220px]">
                    <select
                      value={entityId}
                      onChange={(e) => setEntityId(e.target.value)}
                      className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
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
                      disabled={busy || alreadyLoggedForDay}
                    />
                  </div>

                  {(selected?.fields ?? []).length > 0 ? (
                    <div className="grid gap-2 rounded-xl border p-3">
                      <div className="text-xs font-semibold text-slate-600">Campos dinámicos</div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {selected?.fields.map((f) => (
                          <div key={f.id} className="grid gap-1">
                            <label className="truncate text-xs text-slate-600" title={f.name}>{f.name}</label>
                            {f.field_type === "boolean" ? (
                              <select
                                value={fieldDraft[f.id] ?? ""}
                                onChange={(e) => setFieldDraft((p) => ({ ...p, [f.id]: e.target.value }))}
                                className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                                disabled={busy || alreadyLoggedForDay}
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
                                disabled={busy || alreadyLoggedForDay}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="text-[11px] text-slate-500">
                    {alreadyLoggedForDay
                      ? `Ya existe registro para ${loggedOn}.`
                      : ((selected?.logged_days ?? []).slice(0, 5).length > 0
                        ? `Días con registro: ${(selected?.logged_days ?? []).slice(0, 5).join(", ")}`
                        : "Sin registros previos.")}
                  </div>

                  <Button onClick={() => void save()} disabled={busy || alreadyLoggedForDay} className="w-auto justify-self-start">
                    {busy ? "Guardando..." : alreadyLoggedForDay ? "Ya ingresado" : "Guardar registro"}
                  </Button>
                </>
              ) : (
                <>
                  <div className="text-xs text-slate-500">
                    Entidades sin registro en {loggedOn}: <b>{pendingEntities.length}</b>
                  </div>
                  {pendingEntities.length === 0 ? (
                    <p className="text-sm text-slate-500">No hay pendientes para la fecha seleccionada.</p>
                  ) : (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-[minmax(180px,1fr)_160px_minmax(220px,1fr)] gap-2 rounded-lg border bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                        <div>Entidad</div>
                        <div>Valor</div>
                        <div>Campos dinámicos</div>
                      </div>
                      {pendingEntities.map((e) => (
                        <div key={e.id} className="grid grid-cols-[minmax(180px,1fr)_160px_minmax(220px,1fr)] items-center gap-2">
                          <div className="truncate text-sm text-slate-800" title={e.name}>{e.name}</div>
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
                          {(e.fields ?? []).length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-4">
                              {e.fields.map((f) => (
                                <div key={f.id} className="grid gap-1">
                                  <label className="truncate text-[10px] text-slate-500" title={f.name}>{f.name}</label>
                                  {f.field_type === "boolean" ? (
                                    <select
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
                                  ) : (
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
                                      className="h-9 text-xs"
                                    />
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="text-[11px] text-slate-500">
                    En modo lote puedes cargar valor principal y campos dinámicos en formato compacto.
                  </div>
                  <Button onClick={() => void saveBulkPending()} disabled={busy || pendingEntities.length === 0} className="w-auto justify-self-start">
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
