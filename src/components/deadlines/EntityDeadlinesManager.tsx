"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { computeDateStatus, computeUsageStatus, normalizeDeadlinesMode } from "@/lib/api/deadlinesComputations";

type DeadlineType = {
  id: string;
  name: string;
  measure_by: "date" | "usage";
  requires_document: boolean;
  is_active: boolean;
};

type DeadlineRow = {
  id: string;
  entity_id: string;
  deadline_type_id: string;
  last_done_date: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_daily_average_mode?: "manual" | "auto" | null;
  created_at: string;
  deadline_types?: {
    id: string;
    name: string;
    measure_by: "date" | "usage";
    requires_document: boolean;
    is_active: boolean;
  } | null;
  computed?: {
    status?: "ok" | "incomplete" | string;
    semaphore?: "ok" | "warn" | "urgent" | "critical" | "expired" | null;
  } | null;
};

type UsageLogRow = {
  id: string;
  entity_id: string;
  value: number | null;
  value_text?: string | null;
  logged_on?: string | null;
  logged_at: string;
  created_at?: string;
  field_values?: Array<{
    usage_field_id: string;
    name: string;
    key: string;
    field_type: "text" | "number" | "date" | "boolean" | "select";
    value_text: string | null;
    value_number: number | null;
    value_date: string | null;
    value_boolean: boolean | null;
  }>;
};

type UsageUnit = {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
};

type DeadlineEditDraft = {
  last_done_date: string;
  next_due_date: string;
  last_done_usage: string;
  frequency: string;
  frequency_unit: string;
  usage_daily_average_mode: "manual" | "auto";
  usage_daily_average: string;
};

async function getToken() {
  const { data } = await supabaseAuth.auth.getSession();
  return data.session?.access_token ?? null;
}

function isoToLocalDateInput(iso: string) {
  // "YYYY-MM-DD" in local time
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function computeAutoDailyAverageFromLogs(logs: UsageLogRow[]) {
  const sinceTs = Date.now() - 30 * MS_PER_DAY;
  const inWindow = logs
    .filter((l) => new Date(l.logged_at).getTime() >= sinceTs && Number.isFinite(Number(l.value)))
    .slice()
    .sort((a, b) => new Date(a.logged_at).getTime() - new Date(b.logged_at).getTime());
  if (inWindow.length < 2) return null;

  const first = inWindow[0];
  const last = inWindow[inWindow.length - 1];
  const v0 = Number(first.value);
  const v1 = Number(last.value);
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return null;

  const t0 = new Date(first.logged_at).getTime();
  const t1 = new Date(last.logged_at).getTime();
  const days = Math.floor((t1 - t0) / MS_PER_DAY);
  if (!Number.isFinite(days) || days < 1) return null;

  const delta = v1 - v0;
  if (!Number.isFinite(delta) || delta <= 0) return null;
  const avg = delta / days;
  if (!Number.isFinite(avg) || avg <= 0) return null;
  return avg;
}

function getDeadlineStateDotClass(d: DeadlineRow, usageLogs: UsageLogRow[]) {
  if ((d.deadline_types?.measure_by ?? "date") === "date") {
    const st = computeDateStatus(d.next_due_date);
    if (st.status !== "ok") return "bg-slate-300";
    if (st.semaphore === "expired") return "bg-rose-600";
    if (st.semaphore === "critical") return "bg-orange-500";
    if (st.semaphore === "urgent") return "bg-amber-400";
    if (st.semaphore === "warn") return "bg-yellow-400";
    return "bg-emerald-500";
  }

  const latestNumericLog = usageLogs.find((l) => Number.isFinite(Number(l.value)));
  const latestUsage = latestNumericLog ? Number(latestNumericLog.value) : null;
  const mode = normalizeDeadlinesMode(d.usage_daily_average_mode);
  const manualAvg = Number.isFinite(Number(d.usage_daily_average)) ? Number(d.usage_daily_average) : null;
  const autoAvg = computeAutoDailyAverageFromLogs(usageLogs);
  const effectiveAvg = mode === "manual" ? manualAvg : autoAvg || manualAvg;

  const st = computeUsageStatus({
    latestUsage,
    lastDoneUsage: d.last_done_usage ?? null,
    frequency: d.frequency ?? null,
    dailyAverage: effectiveAvg,
  });
  if (st.status !== "ok") return "bg-slate-300";
  if (st.semaphore === "expired") return "bg-rose-600";
  if (st.semaphore === "critical") return "bg-orange-500";
  if (st.semaphore === "urgent") return "bg-amber-400";
  if (st.semaphore === "warn") return "bg-yellow-400";
  return "bg-emerald-500";
}

function renderUsageFieldValue(v: NonNullable<UsageLogRow["field_values"]>[number]) {
  if (v.value_boolean !== null) return v.value_boolean ? "Sí" : "No";
  if (v.value_number !== null) return String(v.value_number);
  if (v.value_date) return v.value_date;
  if (v.value_text) return v.value_text;
  return "—";
}

function renderUsageMainValue(l: UsageLogRow) {
  const t = String(l.value_text ?? "").trim();
  if (t) return t;
  if (l.value != null && Number.isFinite(Number(l.value))) return String(l.value);
  return "—";
}

export default function EntityDeadlinesManager({
  entityId,
  tracksUsage,
}: {
  entityId: string;
  tracksUsage: boolean;
}) {
  const [types, setTypes] = useState<DeadlineType[]>([]);
  const [usageUnits, setUsageUnits] = useState<UsageUnit[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createBusy, setCreateBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [generalMsg, setGeneralMsg] = useState<string>("");
  const [createMsg, setCreateMsg] = useState<string>("");
  const [editMsg, setEditMsg] = useState<string>("");

  // usage logs
  const [usageLogs, setUsageLogs] = useState<UsageLogRow[]>([]);
  const [usageLogValue, setUsageLogValue] = useState<string>("");
  const [usageLogLoggedAt, setUsageLogLoggedAt] = useState<string>(() => isoToLocalDateInput(new Date().toISOString()));
  const [usageLogsBusy, setUsageLogsBusy] = useState(false);
  const [usageLogsMsg, setUsageLogsMsg] = useState<string>("");
  const [editingDeadlineId, setEditingDeadlineId] = useState<string>("");
  const [editDraft, setEditDraft] = useState<DeadlineEditDraft | null>(null);
  const [showUsagePanel, setShowUsagePanel] = useState(false);
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const [loadedDetails, setLoadedDetails] = useState(false);

  // form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deadlineTypeId, setDeadlineTypeId] = useState<string>("");
  const selectedType = useMemo(() => types.find((t) => t.id === deadlineTypeId) || null, [types, deadlineTypeId]);
  const usageUnitNameSet = useMemo(() => new Set(usageUnits.map((u) => u.name)), [usageUnits]);

  const [lastDoneDate, setLastDoneDate] = useState<string>("");
  const [nextDueDate, setNextDueDate] = useState<string>("");

  const [lastDoneUsage, setLastDoneUsage] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("");
  const [frequencyUnit, setFrequencyUnit] = useState<string>("");
  const [usageDailyAverage, setUsageDailyAverage] = useState<string>("");
  const [usageDailyAverageMode, setUsageDailyAverageMode] = useState<"manual" | "auto">("manual");
  const anyBusy = createBusy || editBusy;

  useEffect(() => {
    setSectionExpanded(true);
    setLoadedDetails(false);
    setTypes([]);
    setUsageUnits([]);
    setDeadlines([]);
    setUsageLogs([]);
    setDeadlineTypeId("");
    setShowCreateForm(false);
    setGeneralMsg("");
    setCreateMsg("");
    setEditMsg("");
    void bootstrap(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function bootstrap(loadDetails = true) {
    setLoading(true);
    setGeneralMsg("");
    await Promise.all([loadTypes(), loadUsageUnits()]);
    if (loadDetails) {
      await Promise.all([loadDeadlines(), tracksUsage ? loadUsageLogs() : Promise.resolve()]);
      setLoadedDetails(true);
    }
    setLoading(false);
  }

  async function loadTypes() {
    const token = await getToken();
    if (!token) {
      setUsageLogsBusy(false);
      return;
    }

    const res = await fetch("/api/deadline-types?active=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGeneralMsg(json.error || "No se pudieron cargar los tipos");
      setTypes([]);
      setDeadlineTypeId("");
      return;
    }
    const list: DeadlineType[] = json.deadline_types ?? [];
    setTypes(list);
    if (list.length === 0) setDeadlineTypeId("");
    if (deadlineTypeId && !list.some((t) => t.id === deadlineTypeId)) setDeadlineTypeId("");
  }

  async function loadUsageUnits() {
    const token = await getToken();
    if (!token) {
      setUsageLogsBusy(false);
      return;
    }

    const res = await fetch("/api/usage-units?active=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGeneralMsg((prev) => prev || json.error || "No se pudieron cargar las unidades de uso");
      setUsageUnits([]);
      return;
    }

    const list: UsageUnit[] = json.usage_units ?? [];
    setUsageUnits(list);
  }

  async function loadDeadlines() {
    const token = await getToken();
    if (!token) {
      setUsageLogsBusy(false);
      return;
    }

    const res = await fetch(`/api/deadlines?entity_id=${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setGeneralMsg(json.error || "No se pudieron cargar los vencimientos");
      setDeadlines([]);
      return;
    }
    setDeadlines(json.deadlines ?? []);
  }

  async function loadUsageLogs(limit = 10) {
    const token = await getToken();
    if (!token) {
      setUsageLogsBusy(false);
      return;
    }

    const res = await fetch(`/api/usage-logs?entity_id=${encodeURIComponent(entityId)}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUsageLogsMsg(json.error || "No se pudieron cargar los registros de uso");
      setUsageLogs([]);
      return;
    }
    setUsageLogsMsg("");
    setUsageLogs(json.usage_logs ?? []);
  }

  useEffect(() => {
    // keep selected type, reset only the inputs
    setCreateMsg("");
    setLastDoneDate("");
    setNextDueDate("");
    setLastDoneUsage("");
    setFrequency("");
    setFrequencyUnit(usageUnits[0]?.name ?? "");
    setUsageDailyAverage("");
    setUsageDailyAverageMode("manual");
  }, [deadlineTypeId, usageUnits]);

  useEffect(() => {
    if (!sectionExpanded) return;
    if (loadedDetails) return;
    void (async () => {
      setLoading(true);
      await Promise.all([loadDeadlines(), tracksUsage ? loadUsageLogs() : Promise.resolve()]);
      setLoadedDetails(true);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionExpanded, loadedDetails, tracksUsage]);

  async function createDeadline() {
    if (!deadlineTypeId) {
      setCreateMsg("Debes seleccionar un tipo de vencimiento");
      return;
    }

    setCreateBusy(true);
    setCreateMsg("");

    const token = await getToken();
    if (!token) {
      setCreateBusy(false);
      return;
    }

    const payload: Record<string, unknown> = {
      entity_id: entityId,
      deadline_type_id: deadlineTypeId,
    };

    if (selectedType?.measure_by === "date") {
      if (!nextDueDate) {
        setCreateMsg("Para tipo por fecha: debes indicar next due date");
        setCreateBusy(false);
        return;
      }
      payload.last_done_date = lastDoneDate || null;
      payload.next_due_date = nextDueDate;
    } else {
      // usage
      if (lastDoneUsage === "" || frequency === "") {
        setCreateMsg("Para tipo por uso: completa last done usage y frecuencia");
        setCreateBusy(false);
        return;
      }
      if (!frequencyUnit) {
        setCreateMsg("Para tipo por uso: debes seleccionar una unidad");
        setCreateBusy(false);
        return;
      }

      if (usageDailyAverageMode === "manual" && usageDailyAverage === "") {
        setCreateMsg("Para promedio manual: debes indicar el promedio diario");
        setCreateBusy(false);
        return;
      }

      payload.last_done_usage = Number(lastDoneUsage);
      payload.frequency = Number(frequency);
      payload.frequency_unit = frequencyUnit;
      payload.usage_daily_average_mode = usageDailyAverageMode;
      payload.usage_daily_average = usageDailyAverageMode === "manual" ? Number(usageDailyAverage) : null;
    }

    const res = await fetch("/api/deadlines", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCreateMsg(json.error || "No se pudo crear el vencimiento");
      setCreateBusy(false);
      return;
    }

    setCreateMsg("");
    await loadDeadlines();
    setShowCreateForm(false);
    setDeadlineTypeId("");
    setCreateBusy(false);
  }

  async function createUsageLog() {
    setUsageLogsBusy(true);
    setUsageLogsMsg("");

    const token = await getToken();
    if (!token) {
      setUsageLogsBusy(false);
      return;
    }

    const valueNum = Number(usageLogValue);
    if (!Number.isFinite(valueNum)) {
      setUsageLogsMsg("Ingresa un valor numérico válido");
      setUsageLogsBusy(false);
      return;
    }

    const res = await fetch("/api/usage-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        entity_id: entityId,
        value: valueNum,
        logged_on: usageLogLoggedAt || null,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUsageLogsMsg(json.error || "No se pudo guardar el registro de uso");
      setUsageLogsBusy(false);
      return;
    }

    setUsageLogValue("");
    setUsageLogLoggedAt(isoToLocalDateInput(new Date().toISOString()));
    await loadUsageLogs();
    setUsageLogsBusy(false);
  }

  async function deleteUsageLog(id: string) {
    setUsageLogsBusy(true);
    setUsageLogsMsg("");

    const token = await getToken();
    if (!token) {
      setUsageLogsBusy(false);
      return;
    }

    const res = await fetch(`/api/usage-logs?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUsageLogsMsg(json.error || "No se pudo eliminar el registro");
      setUsageLogsBusy(false);
      return;
    }

    await loadUsageLogs();
    setUsageLogsBusy(false);
  }

  function startEditDeadline(d: DeadlineRow) {
    setEditingDeadlineId(d.id);
    setEditDraft({
      last_done_date: d.last_done_date ?? "",
      next_due_date: d.next_due_date ?? "",
      last_done_usage: d.last_done_usage != null ? String(d.last_done_usage) : "",
      frequency: d.frequency != null ? String(d.frequency) : "",
      frequency_unit: d.frequency_unit ?? usageUnits[0]?.name ?? "",
      usage_daily_average_mode:
        (d.usage_daily_average_mode ?? "manual") === "auto" ? "auto" : "manual",
      usage_daily_average: d.usage_daily_average != null ? String(d.usage_daily_average) : "",
    });
    setEditMsg("");
  }

  function cancelEditDeadline() {
    setEditingDeadlineId("");
    setEditDraft(null);
    setEditMsg("");
  }

  async function saveEditedDeadline(d: DeadlineRow) {
    if (!editDraft) return;

    setEditBusy(true);
    setEditMsg("");

    const token = await getToken();
    if (!token) {
      setEditBusy(false);
      return;
    }

    const payload: Record<string, unknown> = { id: d.id };

    if (d.deadline_types?.measure_by === "date") {
      if (!editDraft.next_due_date) {
        setEditMsg("Para vencimientos por fecha: next due date es requerido.");
        setEditBusy(false);
        return;
      }
      payload.last_done_date = editDraft.last_done_date || null;
      payload.next_due_date = editDraft.next_due_date;
    } else {
      if (editDraft.last_done_usage === "" || editDraft.frequency === "") {
        setEditMsg("Para vencimientos por uso: last done usage y frecuencia son requeridos.");
        setEditBusy(false);
        return;
      }
      if (!editDraft.frequency_unit) {
        setEditMsg("Para vencimientos por uso: la unidad es requerida.");
        setEditBusy(false);
        return;
      }
      if (
        editDraft.usage_daily_average_mode === "manual" &&
        editDraft.usage_daily_average === ""
      ) {
        setEditMsg("Para modo manual: promedio diario es requerido.");
        setEditBusy(false);
        return;
      }

      payload.last_done_usage = Number(editDraft.last_done_usage);
      payload.frequency = Number(editDraft.frequency);
      payload.frequency_unit = editDraft.frequency_unit;
      payload.usage_daily_average_mode = editDraft.usage_daily_average_mode;
      payload.usage_daily_average =
        editDraft.usage_daily_average_mode === "manual"
          ? Number(editDraft.usage_daily_average)
          : null;
    }

    const res = await fetch("/api/deadlines", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEditMsg(json.error || "No se pudo actualizar el vencimiento");
      setEditBusy(false);
      return;
    }

    cancelEditDeadline();
    await loadDeadlines();
    setEditBusy(false);
  }

  async function deleteDeadline(id: string) {
    const ok = window.confirm("¿Eliminar este vencimiento asignado? Esta acción no se puede deshacer.");
    if (!ok) return;

    setEditBusy(true);
    setEditMsg("");

    const token = await getToken();
    if (!token) {
      setEditBusy(false);
      return;
    }

    const res = await fetch(`/api/deadlines?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEditMsg(json.error || "No se pudo eliminar el vencimiento");
      setEditBusy(false);
      return;
    }

    if (editingDeadlineId === id) {
      cancelEditDeadline();
    }
    await loadDeadlines();
    setEditBusy(false);
  }

  return (
    <section className="mt-3 space-y-3 rounded-xl border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-base font-semibold">Vencimientos</h3>
        <div className="flex items-center gap-2">
          {types.length > 0 ? (
            <>
              <Button
                onClick={() => {
                  setShowCreateForm(true);
                  setCreateMsg("");
                }}
                disabled={createBusy || showCreateForm}
                size="sm"
                className="!border-emerald-600 !bg-emerald-600 !text-white hover:!bg-emerald-700"
              >
                Agregar vencimiento
              </Button>
              {showCreateForm && sectionExpanded ? (
                <Button
                  onClick={() => {
                    setShowCreateForm(false);
                    setCreateMsg("");
                    setDeadlineTypeId("");
                  }}
                  disabled={createBusy}
                  variant="outline"
                  size="sm"
                >
                  Cancelar
                </Button>
              ) : null}
            </>
          ) : null}
          <Button
            onClick={() => void bootstrap(true)}
            disabled={anyBusy || usageLogsBusy}
            variant="outline"
            size="sm"
          >
            Refrescar
          </Button>
        </div>
      </div>

      {!sectionExpanded ? null : generalMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{generalMsg}</p> : null}

      {sectionExpanded && tracksUsage ? (
        <div className="rounded-xl border bg-slate-50/50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="m-0 text-sm font-semibold">Registro de uso</h4>
              <p className="mt-1 text-xs text-slate-500">Fuente para cálculo automático del promedio diario.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => setShowUsagePanel((v) => !v)} variant="outline" size="sm" disabled={usageLogsBusy}>
                {showUsagePanel ? "Ocultar" : "Mostrar"}
              </Button>
              <Button onClick={() => loadUsageLogs()} variant="outline" size="sm" disabled={usageLogsBusy}>
                Actualizar
              </Button>
            </div>
          </div>

          {showUsagePanel ? (
            <>
              {usageLogsMsg ? <p className="mt-2 whitespace-pre-wrap text-sm text-rose-600">{usageLogsMsg}</p> : null}

              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(180px,1fr)_180px_auto] md:items-end">
                <label className="grid gap-1 text-xs text-slate-600">
                  Valor de uso
                  <Input
                    inputMode="decimal"
                    value={usageLogValue}
                    onChange={(e) => setUsageLogValue(e.target.value)}
                    placeholder="Ej: 1530"
                    disabled={usageLogsBusy}
                  />
                </label>

                <label className="grid gap-1 text-xs text-slate-600">
                  Fecha
                  <Input
                    type="date"
                    value={usageLogLoggedAt}
                    onChange={(e) => setUsageLogLoggedAt(e.target.value)}
                    disabled={usageLogsBusy}
                  />
                </label>

                <Button onClick={createUsageLog} disabled={usageLogsBusy} className="min-h-10">
                  {usageLogsBusy ? "Guardando..." : "Guardar uso"}
                </Button>
              </div>

              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold text-slate-700">Últimos registros</div>
                {usageLogs.length === 0 ? (
                  <p className="text-sm text-slate-500">Aún no hay registros de uso para esta entidad.</p>
                ) : (
                  <div className="space-y-1.5">
                    {usageLogs.map((l) => (
                      <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-2.5 py-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-semibold">{renderUsageMainValue(l)}</Badge>
                            <span className="text-xs text-slate-500">{String(l.logged_on ?? "").trim() || new Date(l.logged_at).toLocaleDateString(undefined, { timeZone: "UTC" })}</span>
                          </div>
                          {Array.isArray(l.field_values) && l.field_values.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {l.field_values.map((fv) => (
                                <Badge key={`${l.id}-${fv.usage_field_id}`} variant="outline" className="bg-slate-50 text-[10px] text-slate-600">
                                  {(fv.name || fv.key || "Campo")}: {renderUsageFieldValue(fv)}
                                </Badge>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <Button onClick={() => deleteUsageLog(l.id)} disabled={usageLogsBusy} variant="outline" size="sm">
                          Eliminar
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {sectionExpanded ? (
      <div className="grid gap-2">
        {types.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <strong>No hay tipos de vencimiento disponibles.</strong>
            <div className="mt-1 text-xs">
              Crea al menos un tipo de vencimiento en <code>/app/deadline-types</code> para poder agregar vencimientos a esta entidad.
            </div>
          </div>
        ) : (
          <>
            {showCreateForm ? (
              <>
                {createMsg ? <p className="m-0 whitespace-pre-wrap text-sm text-rose-600">{createMsg}</p> : null}
                <div className="grid gap-2">
                  <div className="grid gap-1 text-xs text-slate-600 md:max-w-[520px]">
                    <span>Tipo</span>
                    <select
                      value={deadlineTypeId}
                      onChange={(e) => setDeadlineTypeId(e.target.value)}
                      className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                      disabled={createBusy}
                    >
                      <option value="">Selecciona un tipo…</option>
                      {types.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.measure_by === "date" ? "fecha" : "uso"})
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedType?.measure_by === "date" ? (
                    <div className="grid gap-1 text-xs text-slate-600 md:max-w-[220px]">
                      <span>Última realización (opcional)</span>
                      <Input
                        type="date"
                        value={lastDoneDate}
                        onChange={(e) => setLastDoneDate(e.target.value)}
                        disabled={createBusy}
                      />
                    </div>
                  ) : null}

                  <div className="grid gap-2">
                    {selectedType?.measure_by === "date" ? (
                      <div className="grid gap-1 text-xs text-slate-600 md:max-w-[220px]">
                        <span>Next due date</span>
                        <Input
                          type="date"
                          value={nextDueDate}
                          onChange={(e) => setNextDueDate(e.target.value)}
                          disabled={createBusy}
                        />
                      </div>
                    ) : selectedType?.measure_by === "usage" ? (
                      <div className="grid gap-2">
                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="grid gap-1 text-xs text-slate-600">
                            <span>Last done usage</span>
                            <Input
                              inputMode="decimal"
                              value={lastDoneUsage}
                              onChange={(e) => setLastDoneUsage(e.target.value)}
                              placeholder="Ej: 1200"
                              disabled={createBusy}
                            />
                          </div>
                          <div className="grid gap-1 text-xs text-slate-600">
                            <span>Frecuencia</span>
                            <Input
                              inputMode="decimal"
                              value={frequency}
                              onChange={(e) => setFrequency(e.target.value)}
                              placeholder="Ej: 250"
                              disabled={createBusy}
                            />
                          </div>
                        </div>

                        <div className="grid gap-2 md:grid-cols-2">
                          <div className="grid gap-1 text-xs text-slate-600">
                            <span>Unidad</span>
                            <select
                              value={frequencyUnit}
                              onChange={(e) => setFrequencyUnit(e.target.value)}
                              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                              disabled={createBusy}
                            >
                              {!frequencyUnit ? <option value="">Selecciona unidad...</option> : null}
                              {usageUnits.map((u) => (
                                <option key={u.id} value={u.name}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                            {usageUnits.length === 0 ? (
                              <div className="text-[11px] text-rose-600">
                                No hay unidades activas. Crea una en <code>/app/usage-units</code>.
                              </div>
                            ) : null}
                          </div>
                          <div className="grid gap-1 text-xs text-slate-600">
                            <span>Promedio diario (modo)</span>
                            <select
                              value={usageDailyAverageMode}
                              onChange={(e) => setUsageDailyAverageMode(e.target.value as "manual" | "auto")}
                              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                              disabled={createBusy}
                            >
                              <option value="manual">Manual</option>
                              <option value="auto">Automático</option>
                            </select>
                          </div>
                        </div>

                        <div className="grid gap-1 text-xs text-slate-600">
                          <span>Promedio diario{usageDailyAverageMode === "auto" ? " (calculado por el sistema)" : ""}</span>
                          <Input
                            inputMode="decimal"
                            value={usageDailyAverageMode === "manual" ? usageDailyAverage : ""}
                            onChange={(e) => setUsageDailyAverage(e.target.value)}
                            placeholder={usageDailyAverageMode === "manual" ? "Ej: 6" : "Se calculará automáticamente"}
                            disabled={createBusy || usageDailyAverageMode === "auto"}
                          />
                          {usageDailyAverageMode === "auto" && (
                            <div className="text-[11px] text-slate-500">
                              El promedio se calcula usando los usage_logs de la entidad (backend).
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-500">
                        Selecciona un tipo para completar el resto del formulario.
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={createDeadline} disabled={createBusy || !deadlineTypeId} className="w-full max-w-[240px]">
                    {createBusy ? "Guardando..." : "Guardar vencimiento"}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
      ) : null}

      {sectionExpanded ? (
      <div className="border-t pt-2">
        <h4 className="m-0 text-sm font-semibold">Asignados</h4>
      </div>
      ) : null}
      {sectionExpanded && editMsg ? <p className="mt-1 whitespace-pre-wrap text-sm text-rose-600">{editMsg}</p> : null}

      {!sectionExpanded ? null : !loadedDetails ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader label="Cargando datos de vencimientos..." />
        </div>
      ) : loading ? (
        <div className="flex min-h-[50vh] items-center justify-center py-3">
          <Loader label="Cargando vencimientos..." />
        </div>
      ) : deadlines.length === 0 ? (
        <p className="text-sm text-slate-500">Esta entidad aún no tiene vencimientos.</p>
      ) : (
        <div className="grid gap-2">
          {deadlines.map((d) => {
            const t = d.deadline_types;
            const isEditing = editingDeadlineId === d.id;
            return (
              <div key={d.id} className="rounded-xl border bg-white p-3">
                {!isEditing ? (
                  <div className="grid items-center gap-2 lg:grid-cols-[minmax(210px,1.3fr)_minmax(120px,0.9fr)_minmax(140px,1fr)_minmax(170px,1fr)_auto]">
                    <div className="relative min-w-0 pl-5">
                      <span
                        className="absolute left-0 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center"
                        title="Estado actual del vencimiento"
                        aria-label="Estado actual del vencimiento"
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${getDeadlineStateDotClass(d, usageLogs)}`} />
                      </span>
                      <div className="truncate text-sm font-semibold text-slate-900">{t?.name ?? "Tipo desconocido"}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <Badge variant="outline">{t?.measure_by === "date" ? "Por fecha" : "Por uso"}</Badge>
                        <Badge variant="outline">{t?.requires_document ? "Requiere doc" : "Sin doc"}</Badge>
                        <span>{new Date(d.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="grid gap-0.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">
                        {t?.measure_by === "date" ? "Última realización" : "Último uso"}
                      </span>
                      <span className="text-sm text-slate-800">
                        {t?.measure_by === "date" ? d.last_done_date ?? "-" : d.last_done_usage ?? "-"}
                      </span>
                    </div>
                    <div className="grid gap-0.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">
                        {t?.measure_by === "date" ? "Próximo vencimiento" : "Frecuencia"}
                      </span>
                      <span className="text-sm text-slate-800">
                        {t?.measure_by === "date"
                          ? d.next_due_date ?? "-"
                          : `${d.frequency ?? "-"} ${d.frequency_unit ?? ""}`.trim()}
                      </span>
                    </div>
                    <div className="grid gap-0.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">
                        {t?.measure_by === "date" ? "Creado" : "Promedio diario"}
                      </span>
                      <span className="text-sm text-slate-800">
                        {t?.measure_by === "date" ? (
                          new Date(d.created_at).toLocaleDateString()
                        ) : (
                          <>
                            {d.usage_daily_average ?? "-"}{" "}
                            <span className="text-slate-500">
                              ({(d.usage_daily_average_mode ?? "manual") === "auto" ? "auto" : "manual"})
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-start gap-1.5 lg:justify-end">
                      <Button onClick={() => startEditDeadline(d)} disabled={editBusy} variant="outline" size="sm">
                        Editar
                      </Button>
                      <Button
                        onClick={() => deleteDeadline(d.id)}
                        disabled={editBusy}
                        variant="destructive"
                        size="sm"
                        title="Eliminar vencimiento"
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="relative pl-5">
                      <span
                        className="absolute left-0 top-1/2 inline-flex h-4 w-4 -translate-y-1/2 items-center justify-center"
                        title="Estado actual del vencimiento"
                        aria-label="Estado actual del vencimiento"
                      >
                        <span className={`h-2.5 w-2.5 rounded-full ${getDeadlineStateDotClass(d, usageLogs)}`} />
                      </span>
                      <div className="text-sm font-semibold text-slate-900">{t?.name ?? "Tipo desconocido"}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <Badge variant="outline">{t?.measure_by === "date" ? "Por fecha" : "Por uso"}</Badge>
                      <Badge variant="outline">{t?.requires_document ? "Requiere doc" : "Sin doc"}</Badge>
                      <span>{new Date(d.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {editingDeadlineId === d.id ? (
                    <div className="flex flex-wrap gap-1.5">
                      <Button onClick={() => saveEditedDeadline(d)} disabled={editBusy} size="sm">
                        Guardar
                      </Button>
                      <Button onClick={cancelEditDeadline} disabled={editBusy} variant="outline" size="sm">
                        Cancelar
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      <Button onClick={() => startEditDeadline(d)} disabled={editBusy} variant="outline" size="sm">
                        Editar
                      </Button>
                      <Button
                        onClick={() => deleteDeadline(d.id)}
                        disabled={editBusy}
                        variant="destructive"
                        size="sm"
                        title="Eliminar vencimiento"
                      >
                        Eliminar
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-2 grid items-start gap-2 md:grid-cols-2 lg:grid-cols-4">
                  {t?.measure_by === "date" ? (
                    <div className="grid gap-1 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">Última realización</span>
                      {editingDeadlineId === d.id ? (
                        <Input
                          type="date"
                          value={editDraft?.last_done_date ?? ""}
                          onChange={(e) =>
                            setEditDraft((prev) => (prev ? { ...prev, last_done_date: e.target.value } : prev))
                          }
                          disabled={editBusy}
                        />
                      ) : (
                        <span className="text-sm text-slate-800">{d.last_done_date ?? "-"}</span>
                      )}
                    </div>
                  ) : null}
                  {t?.measure_by === "date" ? (
                    <div className="grid gap-1 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">Próximo vencimiento</span>
                      {editingDeadlineId === d.id ? (
                        <Input
                          type="date"
                          value={editDraft?.next_due_date ?? ""}
                          onChange={(e) =>
                            setEditDraft((prev) => (prev ? { ...prev, next_due_date: e.target.value } : prev))
                          }
                          disabled={editBusy}
                        />
                      ) : (
                        <span className="text-sm text-slate-800">{d.next_due_date ?? "-"}</span>
                      )}
                    </div>
                  ) : null}
                  {t?.measure_by === "date" ? (
                    <div className="hidden lg:block" aria-hidden />
                  ) : null}
                  {t?.measure_by === "date" ? (
                    <div className="hidden lg:block" aria-hidden />
                  ) : (
                    <>
                      <div className="grid gap-1 text-xs text-slate-600">
                        <span className="font-medium text-slate-700">Último uso</span>
                        {editingDeadlineId === d.id ? (
                          <Input
                            inputMode="decimal"
                            value={editDraft?.last_done_usage ?? ""}
                            onChange={(e) =>
                              setEditDraft((prev) => (prev ? { ...prev, last_done_usage: e.target.value } : prev))
                            }
                            disabled={editBusy}
                          />
                        ) : (
                          <span className="text-sm text-slate-800">{d.last_done_usage ?? "-"}</span>
                        )}
                      </div>
                      <div className="grid gap-1 text-xs text-slate-600">
                        <span className="font-medium text-slate-700">Frecuencia</span>
                        {editingDeadlineId === d.id ? (
                          <div className="grid gap-1">
                            <Input
                              inputMode="decimal"
                              value={editDraft?.frequency ?? ""}
                              onChange={(e) =>
                                setEditDraft((prev) => (prev ? { ...prev, frequency: e.target.value } : prev))
                              }
                              disabled={editBusy}
                            />
                            <select
                              value={editDraft?.frequency_unit ?? ""}
                              onChange={(e) =>
                                setEditDraft((prev) => (prev ? { ...prev, frequency_unit: e.target.value } : prev))
                              }
                              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                              disabled={editBusy}
                            >
                              {editDraft?.frequency_unit && !usageUnitNameSet.has(editDraft.frequency_unit) ? (
                                <option value={editDraft.frequency_unit}>{editDraft.frequency_unit} (actual)</option>
                              ) : null}
                              {!editDraft?.frequency_unit ? <option value="">Selecciona unidad...</option> : null}
                              {usageUnits.map((u) => (
                                <option key={u.id} value={u.name}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <span className="text-sm text-slate-800">{d.frequency ?? "-"} {d.frequency_unit ?? ""}</span>
                        )}
                      </div>
                      <div className="grid gap-1 text-xs text-slate-600">
                        <span className="font-medium text-slate-700">Promedio diario</span>
                        {editingDeadlineId === d.id ? (
                          <div className="grid gap-1">
                            <select
                              value={editDraft?.usage_daily_average_mode ?? "manual"}
                              onChange={(e) =>
                                setEditDraft((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        usage_daily_average_mode: e.target.value as "manual" | "auto",
                                      }
                                    : prev
                                )
                              }
                              className="h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                              disabled={editBusy}
                            >
                              <option value="manual">manual</option>
                              <option value="auto">auto</option>
                            </select>
                            <Input
                              inputMode="decimal"
                              value={
                                (editDraft?.usage_daily_average_mode ?? "manual") === "manual"
                                  ? editDraft?.usage_daily_average ?? ""
                                  : ""
                              }
                              onChange={(e) =>
                                setEditDraft((prev) =>
                                  prev ? { ...prev, usage_daily_average: e.target.value } : prev
                                )
                              }
                              disabled={editBusy || (editDraft?.usage_daily_average_mode ?? "manual") === "auto"}
                            />
                          </div>
                        ) : (
                          <span className="text-sm text-slate-800">
                            {d.usage_daily_average ?? "-"}{" "}
                            <span className="text-slate-500">
                              ({(d.usage_daily_average_mode ?? "manual") === "auto" ? "auto" : "manual"})
                            </span>
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
