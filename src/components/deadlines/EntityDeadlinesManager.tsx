"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useNotify } from "@/components/ui/notifications";
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
  suggested_values?: string[];
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

function formatDisplayDate(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-");
    return `${day} / ${month} / ${year}`;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day} / ${month} / ${year}`;
}

function monthKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function dayKeyFromDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftMonth(monthKey: string, delta: number) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKeyFromDate(new Date());
  const base = new Date(year, month - 1 + delta, 1);
  return monthKeyFromDate(base);
}

function monthLabel(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString("es-CL", { month: "long", year: "numeric" });
}

function buildMonthDays(monthKey: string) {
  const [yearRaw, monthRaw] = monthKey.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) return [] as Array<{ key: string; dayNumber: number }>;
  const daysInMonth = new Date(year, month, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, index) => {
    const date = new Date(year, month - 1, index + 1);
    return { key: dayKeyFromDate(date), dayNumber: index + 1 };
  });
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
  usageUnitId,
}: {
  entityId: string;
  tracksUsage: boolean;
  usageUnitId?: string | null;
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
  const [usageLogLoggedAt, setUsageLogLoggedAt] = useState<string>("");
  const [usageLogsBusy, setUsageLogsBusy] = useState(false);
  const [usageLogsMsg, setUsageLogsMsg] = useState<string>("");
  const [usageLogsMsgTone, setUsageLogsMsgTone] = useState<"error" | "success">("error");
  const [usageHistoryMonth, setUsageHistoryMonth] = useState<string>(() => monthKeyFromDate(new Date()));
  const [selectedUsageLogDay, setSelectedUsageLogDay] = useState<string>("");
  const [editingDeadlineId, setEditingDeadlineId] = useState<string>("");
  const [editDraft, setEditDraft] = useState<DeadlineEditDraft | null>(null);
  const [showUsagePanel, setShowUsagePanel] = useState(false);
  const [sectionExpanded, setSectionExpanded] = useState(true);
  const [loadedDetails, setLoadedDetails] = useState(false);
  const notify = useNotify();

  // form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deadlineTypeId, setDeadlineTypeId] = useState<string>("");
  const assignedDeadlineTypeIds = useMemo(
    () => new Set(deadlines.map((d) => String(d.deadline_type_id ?? "").trim()).filter((id) => id.length > 0)),
    [deadlines]
  );
  const availableTypes = useMemo(
    () => types.filter((t) => !assignedDeadlineTypeIds.has(String(t.id))),
    [assignedDeadlineTypeIds, types]
  );
  const selectedType = useMemo(
    () => availableTypes.find((t) => t.id === deadlineTypeId) || null,
    [availableTypes, deadlineTypeId]
  );
  const usageUnitNameSet = useMemo(() => new Set(usageUnits.map((u) => u.name)), [usageUnits]);
  const selectedUsageUnit = useMemo(
    () => usageUnits.find((u) => u.id === String(usageUnitId ?? "")) ?? null,
    [usageUnitId, usageUnits]
  );
  const usageSuggestedValues = useMemo(
    () => (selectedUsageUnit?.suggested_values ?? []).map((v) => String(v ?? "").trim()).filter((v) => v.length > 0),
    [selectedUsageUnit]
  );
  const usageSuggestedValueError = useMemo(() => {
    if (usageSuggestedValues.length === 0) return "";
    const clean = String(usageLogValue ?? "").trim();
    if (!clean) return "Debes seleccionar uno de los valores sugeridos.";
    if (!usageSuggestedValues.includes(clean)) return "El valor debe coincidir con uno de los sugeridos.";
    return "";
  }, [usageLogValue, usageSuggestedValues]);
  const usageLogExistsForSelectedDay = useMemo(() => {
    const selected = String(usageLogLoggedAt ?? "").trim();
    if (!selected) return false;
    return usageLogs.some((log) => {
      const loggedOn = String(log.logged_on ?? "").trim();
      if (loggedOn) return loggedOn === selected;
      return isoToLocalDateInput(log.logged_at) === selected;
    });
  }, [usageLogLoggedAt, usageLogs]);
  const usageLogValueNumber = useMemo(() => {
    const raw = String(usageLogValue ?? "").trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }, [usageLogValue]);
  const usageLogWouldDecrease = useMemo(() => {
    const selected = String(usageLogLoggedAt ?? "").trim();
    if (!selected || usageLogValueNumber == null) return false;
    const previous = usageLogs
      .filter((log) => {
        const loggedOn = String(log.logged_on ?? "").trim();
        return loggedOn && loggedOn < selected && Number.isFinite(Number(log.value));
      })
      .sort((a, b) => String(b.logged_on ?? "").localeCompare(String(a.logged_on ?? "")))[0];
    return previous ? usageLogValueNumber < Number(previous.value) : false;
  }, [usageLogLoggedAt, usageLogValueNumber, usageLogs]);
  const usageLogWouldExceedNext = useMemo(() => {
    const selected = String(usageLogLoggedAt ?? "").trim();
    if (!selected || usageLogValueNumber == null) return false;
    const next = usageLogs
      .filter((log) => {
        const loggedOn = String(log.logged_on ?? "").trim();
        return loggedOn && loggedOn > selected && Number.isFinite(Number(log.value));
      })
      .sort((a, b) => String(a.logged_on ?? "").localeCompare(String(b.logged_on ?? "")))[0];
    return next ? usageLogValueNumber > Number(next.value) : false;
  }, [usageLogLoggedAt, usageLogValueNumber, usageLogs]);
  const previousNumericUsageValue = useMemo(() => {
    const selected = String(usageLogLoggedAt ?? "").trim();
    if (!selected) return null;
    const previous = usageLogs
      .filter((log) => {
        const loggedOn = String(log.logged_on ?? "").trim();
        return loggedOn && loggedOn < selected && Number.isFinite(Number(log.value));
      })
      .sort((a, b) => String(b.logged_on ?? "").localeCompare(String(a.logged_on ?? "")))[0];
    return previous ? Number(previous.value) : null;
  }, [usageLogLoggedAt, usageLogs]);
  const nextNumericUsageValue = useMemo(() => {
    const selected = String(usageLogLoggedAt ?? "").trim();
    if (!selected) return null;
    const next = usageLogs
      .filter((log) => {
        const loggedOn = String(log.logged_on ?? "").trim();
        return loggedOn && loggedOn > selected && Number.isFinite(Number(log.value));
      })
      .sort((a, b) => String(a.logged_on ?? "").localeCompare(String(b.logged_on ?? "")))[0];
    return next ? Number(next.value) : null;
  }, [usageLogLoggedAt, usageLogs]);
  const usageLogsByDay = useMemo(() => {
    const byDay = new Map<string, UsageLogRow>();
    for (const log of usageLogs) {
      const dayKey = String(log.logged_on ?? "").trim() || isoToLocalDateInput(log.logged_at);
      if (!dayKey) continue;
      if (!byDay.has(dayKey)) byDay.set(dayKey, log);
    }
    return byDay;
  }, [usageLogs]);
  const usageHistoryDays = useMemo(() => buildMonthDays(usageHistoryMonth), [usageHistoryMonth]);
  const usageHistoryMonthHasLogs = useMemo(
    () => usageHistoryDays.some((day) => usageLogsByDay.has(day.key)),
    [usageHistoryDays, usageLogsByDay]
  );
  const selectedUsageLog = useMemo(
    () => (selectedUsageLogDay ? usageLogsByDay.get(selectedUsageLogDay) ?? null : null),
    [selectedUsageLogDay, usageLogsByDay]
  );
  const usageLogPrimaryWarning = useMemo(() => {
    if (usageLogExistsForSelectedDay) return "Para esta fecha ya hay un registro.";
    if (usageSuggestedValueError) return usageSuggestedValueError;
    if (usageLogWouldDecrease) {
      return `El valor no puede ser menor al registro anterior (${previousNumericUsageValue}).`;
    }
    if (usageLogWouldExceedNext) {
      return `El valor no puede ser mayor al registro siguiente (${nextNumericUsageValue}).`;
    }
    return "";
  }, [
    nextNumericUsageValue,
    previousNumericUsageValue,
    usageLogExistsForSelectedDay,
    usageLogWouldDecrease,
    usageLogWouldExceedNext,
    usageSuggestedValueError,
  ]);

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

  useEffect(() => {
    setUsageLogLoggedAt((prev) => prev || isoToLocalDateInput(new Date().toISOString()));
  }, []);

  useEffect(() => {
    if (usageLogsByDay.size === 0) {
      setSelectedUsageLogDay("");
      return;
    }
    if (selectedUsageLogDay && usageHistoryDays.some((day) => day.key === selectedUsageLogDay)) return;
    const firstDayWithLogInMonth = usageHistoryDays.find((day) => usageLogsByDay.has(day.key));
    if (firstDayWithLogInMonth) {
      setSelectedUsageLogDay(firstDayWithLogInMonth.key);
      return;
    }
    setSelectedUsageLogDay(usageHistoryDays[0]?.key ?? "");
  }, [selectedUsageLogDay, usageHistoryDays, usageLogsByDay]);

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

  useEffect(() => {
    if (!deadlineTypeId) return;
    const exists = availableTypes.some((t) => t.id === deadlineTypeId);
    if (!exists) setDeadlineTypeId("");
  }, [availableTypes, deadlineTypeId]);

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
      setUsageLogsMsgTone("error");
      setUsageLogsMsg(json.error || "No se pudieron cargar los registros de uso");
      setUsageLogs([]);
      return;
    }
    setUsageLogsMsgTone("error");
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
      notify.error(json.error || "No se pudo crear el vencimiento");
      setCreateBusy(false);
      return;
    }

    setCreateMsg("");
    await loadDeadlines();
    setShowCreateForm(false);
    setDeadlineTypeId("");
    notify.success("Vencimiento agregado correctamente.");
    setCreateBusy(false);
  }

  async function createUsageLog() {
    setUsageLogsBusy(true);
    setUsageLogsMsg("");
    setUsageLogsMsgTone("error");

    const token = await getToken();
    if (!token) {
      setUsageLogsBusy(false);
      return;
    }

    const cleanUsageValue = String(usageLogValue ?? "").trim();
    if (usageSuggestedValueError) {
      setUsageLogsMsg(usageSuggestedValueError);
      notify.error(usageSuggestedValueError);
      setUsageLogsBusy(false);
      return;
    }
    if (!cleanUsageValue) {
      setUsageLogsMsg("Ingresa un valor de uso válido");
      notify.error("Ingresa un valor de uso válido");
      setUsageLogsBusy(false);
      return;
    }

    const valueNum = Number(cleanUsageValue);
    const isNumericMainValue = Number.isFinite(valueNum);
    if (usageSuggestedValues.length === 0 && !isNumericMainValue) {
      setUsageLogsMsg("Ingresa un valor numérico válido");
      notify.error("Ingresa un valor numérico válido");
      setUsageLogsBusy(false);
      return;
    }
    if (isNumericMainValue && usageLogWouldDecrease) {
      setUsageLogsMsg(`El valor no puede ser menor al registro anterior (${previousNumericUsageValue}).`);
      setUsageLogsBusy(false);
      return;
    }
    if (isNumericMainValue && usageLogWouldExceedNext) {
      setUsageLogsMsg(`El valor no puede ser mayor al registro siguiente (${nextNumericUsageValue}).`);
      setUsageLogsBusy(false);
      return;
    }
    if (usageLogExistsForSelectedDay) {
      setUsageLogsMsg("Para esta fecha ya hay un registro.");
      setUsageLogsBusy(false);
      return;
    }

    const res = await fetch("/api/usage-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        entity_id: entityId,
        ...(isNumericMainValue ? { value: valueNum } : { value_text: cleanUsageValue }),
        logged_on: usageLogLoggedAt || null,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUsageLogsMsgTone("error");
      const message = json.error || "No se pudo guardar el registro de uso";
      setUsageLogsMsg(message);
      notify.error(message);
      setUsageLogsBusy(false);
      return;
    }

    setUsageLogValue("");
    setUsageLogLoggedAt(isoToLocalDateInput(new Date().toISOString()));
    await loadUsageLogs();
    setUsageLogsMsgTone("success");
    setUsageLogsMsg("Registro de uso guardado.");
    notify.success("Registro de uso guardado.");
    setUsageLogsBusy(false);
  }

  async function deleteUsageLog(id: string) {
    const ok = window.confirm("¿Eliminar este registro de uso? Esta acción no se puede deshacer.");
    if (!ok) return;

    setUsageLogsBusy(true);
    setUsageLogsMsg("");
    setUsageLogsMsgTone("error");

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
      setUsageLogsMsgTone("error");
      const message = json.error || "No se pudo eliminar el registro";
      setUsageLogsMsg(message);
      notify.error(message);
      setUsageLogsBusy(false);
      return;
    }

    await loadUsageLogs();
    setUsageLogsMsgTone("success");
    setUsageLogsMsg("Registro de uso eliminado.");
    notify.success("Registro de uso eliminado.");
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
      notify.error(json.error || "No se pudo actualizar el vencimiento");
      setEditBusy(false);
      return;
    }

    cancelEditDeadline();
    await loadDeadlines();
    notify.success("Vencimiento actualizado.");
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
      notify.error(json.error || "No se pudo eliminar el vencimiento");
      setEditBusy(false);
      return;
    }

    if (editingDeadlineId === id) {
      cancelEditDeadline();
    }
    await loadDeadlines();
    notify.success("Vencimiento eliminado.");
    setEditBusy(false);
  }

  return (
    <>
      {tracksUsage ? (
        <section className="mt-3 space-y-3 rounded-xl border bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="m-0 text-base font-semibold">Registro de uso</h3>
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
              {usageLogsMsg ? (
                <p className={`mt-2 whitespace-pre-wrap text-sm ${usageLogsMsgTone === "success" ? "text-emerald-700" : "text-rose-600"}`}>
                  {usageLogsMsg}
                </p>
              ) : null}

              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(180px,1fr)_180px_auto] md:items-end">
                <label className="grid gap-1 text-xs text-slate-600">
                  Valor de uso
                  {usageSuggestedValues.length > 0 ? (
                    <div className="flex min-h-10 flex-wrap gap-1 rounded-xl border border-slate-300 bg-white px-2 py-2">
                      {usageSuggestedValues.map((opt) => {
                        const current = String(usageLogValue ?? "").trim();
                        const active = current === opt;
                        return (
                          <button
                            key={`usage-suggested-${opt}`}
                            type="button"
                            disabled={usageLogsBusy}
                            onClick={() => setUsageLogValue(current === opt ? "" : opt)}
                            className={[
                              "rounded-full border px-2.5 py-1 text-[10px] transition",
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
                      inputMode="decimal"
                      value={usageLogValue}
                      onChange={(e) => setUsageLogValue(e.target.value)}
                      placeholder={selectedUsageUnit?.name ? `Valor (${selectedUsageUnit.name})` : "Ej: 1530"}
                      disabled={usageLogsBusy}
                    />
                  )}
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

                <Button
                  onClick={createUsageLog}
                  disabled={usageLogsBusy || usageLogExistsForSelectedDay || usageLogWouldDecrease || usageLogWouldExceedNext || Boolean(usageSuggestedValueError)}
                  className="min-h-10"
                  title={usageSuggestedValueError || undefined}
                >
                  {usageLogsBusy ? "Guardando..." : "Guardar uso"}
                </Button>
              </div>

              {usageLogPrimaryWarning ? (
                <p className="mt-2 text-sm text-amber-700">{usageLogPrimaryWarning}</p>
              ) : null}

              <div className="mt-3 space-y-2">
                <div className="text-xs font-semibold text-slate-700">Últimos registros</div>
                {usageLogs.length === 0 ? (
                  <p className="text-sm text-slate-500">Aún no hay registros de uso para esta entidad.</p>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,#fbfdff,#f8fafc)] p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-700">Mosaico histórico</div>
                          <div className="text-[11px] text-slate-500">Lectura cronológica por día.</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="outline" size="sm" onClick={() => setUsageHistoryMonth((current) => shiftMonth(current, -1))}>
                            ‹
                          </Button>
                          <div className="min-w-[132px] text-center text-xs font-medium capitalize text-slate-700">
                            {monthLabel(usageHistoryMonth)}
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={() => setUsageHistoryMonth((current) => shiftMonth(current, 1))}>
                            ›
                          </Button>
                        </div>
                      </div>
                      {usageHistoryMonthHasLogs ? (
                        <div className="grid grid-cols-7 gap-1.5">
                          {usageHistoryDays.map((day) => {
                            const hasLog = usageLogsByDay.has(day.key);
                            const selected = selectedUsageLogDay === day.key;
                            const selectedLog = usageLogsByDay.get(day.key);
                            const label = hasLog
                              ? `${day.key} · ${renderUsageMainValue(selectedLog as UsageLogRow)}`
                              : `${day.key} · Sin registro`;
                            return (
                              <button
                                key={day.key}
                                type="button"
                                onClick={() => setSelectedUsageLogDay(day.key)}
                                title={label}
                                className={[
                                  "flex aspect-square min-h-8 items-center justify-center rounded-[7px] border text-[11px] font-medium transition hover:scale-[1.04]",
                                  selected
                                    ? "border-sky-300 bg-sky-100 text-sky-800 shadow-[0_0_0_1px_rgba(125,211,252,0.35)]"
                                    : hasLog
                                      ? "border-emerald-200 bg-emerald-500/80 text-white hover:border-emerald-300"
                                      : "border-slate-200 bg-white text-slate-400 hover:border-slate-300 hover:bg-slate-50",
                                ].join(" ")}
                                aria-label={label}
                              >
                                {day.dayNumber}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-[14px] border border-dashed border-slate-200 bg-white px-3 py-5 text-sm text-slate-500">
                          No hay registros en {monthLabel(usageHistoryMonth)}.
                        </div>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        <div className="inline-flex items-center gap-2">
                          <span className="h-3 w-3 rounded-[4px] border border-emerald-200 bg-emerald-500/80" />
                          Día con registro
                        </div>
                        <div className="inline-flex items-center gap-2">
                          <span className="h-3 w-3 rounded-[4px] border border-slate-200 bg-white" />
                          Sin registro
                        </div>
                        <div className="inline-flex items-center gap-2">
                          <span className="h-3 w-3 rounded-[4px] border border-sky-300 bg-sky-100" />
                          Seleccionado
                        </div>
                      </div>
                    </div>

                    {selectedUsageLogDay ? (
                      <div className="rounded-[18px] border border-slate-200 bg-white p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Detalle del día</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900">{formatDisplayDate(selectedUsageLogDay)}</div>
                            <div className="mt-1 text-xs text-slate-500">{selectedUsageLog ? "Registro encontrado." : "Sin registro para esta fecha."}</div>
                          </div>
                          {selectedUsageLog ? (
                            <Button
                              onClick={() => deleteUsageLog(selectedUsageLog.id)}
                              disabled={usageLogsBusy}
                              variant="outline"
                              size="sm"
                            >
                              Eliminar
                            </Button>
                          ) : null}
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-slate-600">
                          {selectedUsageLog ? (
                            <>
                              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                                <span className="font-medium text-slate-700">Valor:</span>{" "}
                                {renderUsageMainValue(selectedUsageLog)}
                              </div>
                              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                                <span className="font-medium text-slate-700">Registrado:</span>{" "}
                                {new Date(selectedUsageLog.logged_at).toLocaleString()}
                              </div>
                              {Array.isArray(selectedUsageLog.field_values) && selectedUsageLog.field_values.length > 0 ? (
                                <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                                  <div className="mb-2 font-medium text-slate-700">Campos asociados</div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {selectedUsageLog.field_values.map((fv) => (
                                      <Badge key={`${selectedUsageLog.id}-${fv.usage_field_id}`} variant="outline" className="bg-white text-[10px] text-slate-600">
                                        {(fv.name || fv.key || "Campo")}: {renderUsageFieldValue(fv)}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50/70 px-3 py-2 text-slate-500">
                                  Este registro no tiene campos adicionales.
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-slate-500">
                              No hay registro guardado para esta fecha en el mes seleccionado.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="mt-3 space-y-3 rounded-xl border bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-base font-semibold">Vencimientos</h3>
          <div className="flex items-center gap-2">
            {availableTypes.length > 0 ? (
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

        {sectionExpanded ? (
        <div className="grid gap-2">
        {types.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <strong>No hay tipos de vencimiento disponibles.</strong>
            <div className="mt-1 text-xs">
              Crea al menos un tipo de vencimiento en <code>/app/deadline-types</code> para poder agregar vencimientos a esta entidad.
            </div>
          </div>
        ) : availableTypes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <strong>Todos los tipos ya estan asignados.</strong>
            <div className="mt-1 text-xs">
              Si necesitas actualizar uno, usa <b>Editar</b> en la lista de vencimientos asignados.
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
                      {availableTypes.map((t) => (
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
                        <span>{formatDisplayDate(d.created_at)}</span>
                      </div>
                    </div>
                    <div className="grid gap-0.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">
                        {t?.measure_by === "date" ? "Última realización" : "Último uso"}
                      </span>
                      <span className="text-sm text-slate-800">
                        {t?.measure_by === "date" ? formatDisplayDate(d.last_done_date) : d.last_done_usage ?? "-"}
                      </span>
                    </div>
                    <div className="grid gap-0.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">
                        {t?.measure_by === "date" ? "Próximo vencimiento" : "Frecuencia"}
                      </span>
                      <span className="text-sm text-slate-800">
                        {t?.measure_by === "date"
                          ? formatDisplayDate(d.next_due_date)
                          : `${d.frequency ?? "-"} ${d.frequency_unit ?? ""}`.trim()}
                      </span>
                    </div>
                    <div className="grid gap-0.5 text-xs text-slate-600">
                      <span className="font-medium text-slate-700">
                        {t?.measure_by === "date" ? "Creado" : "Promedio diario"}
                      </span>
                      <span className="text-sm text-slate-800">
                        {t?.measure_by === "date" ? (
                          formatDisplayDate(d.created_at)
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
                      <span>{formatDisplayDate(d.created_at)}</span>
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
                        <span className="text-sm text-slate-800">{formatDisplayDate(d.last_done_date)}</span>
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
                        <span className="text-sm text-slate-800">{formatDisplayDate(d.next_due_date)}</span>
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
    </>
  );
}
