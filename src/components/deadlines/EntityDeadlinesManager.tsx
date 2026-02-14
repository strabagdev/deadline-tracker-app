"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseAuth } from "@/lib/supabase/authClient";

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
};

type UsageLogRow = {
  id: string;
  entity_id: string;
  value: number;
  logged_at: string;
  created_at?: string;
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

function isoToLocalDatetimeInput(iso: string) {
  // "YYYY-MM-DDTHH:mm" in local time
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function EntityDeadlinesManager({
  entityId,
  tracksUsage,
}: {
  entityId: string;
  tracksUsage: boolean;
}) {
  const [types, setTypes] = useState<DeadlineType[]>([]);
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
  const [usageLogLoggedAt, setUsageLogLoggedAt] = useState<string>(() => isoToLocalDatetimeInput(new Date().toISOString()));
  const [usageLogsBusy, setUsageLogsBusy] = useState(false);
  const [usageLogsMsg, setUsageLogsMsg] = useState<string>("");
  const [editingDeadlineId, setEditingDeadlineId] = useState<string>("");
  const [editDraft, setEditDraft] = useState<DeadlineEditDraft | null>(null);

  // form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deadlineTypeId, setDeadlineTypeId] = useState<string>("");
  const selectedType = useMemo(() => types.find((t) => t.id === deadlineTypeId) || null, [types, deadlineTypeId]);

  const [lastDoneDate, setLastDoneDate] = useState<string>("");
  const [nextDueDate, setNextDueDate] = useState<string>("");

  const [lastDoneUsage, setLastDoneUsage] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("");
  const [frequencyUnit, setFrequencyUnit] = useState<string>("hours");
  const [usageDailyAverage, setUsageDailyAverage] = useState<string>("");
  const [usageDailyAverageMode, setUsageDailyAverageMode] = useState<"manual" | "auto">("manual");
  const anyBusy = createBusy || editBusy;

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function bootstrap() {
    setLoading(true);
    setGeneralMsg("");
    await Promise.all([loadTypes(), loadDeadlines(), tracksUsage ? loadUsageLogs() : Promise.resolve()]);
    setLoading(false);
  }

  async function loadTypes() {
    const token = await getToken();
    if (!token) return;

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

  async function loadDeadlines() {
    const token = await getToken();
    if (!token) return;

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
    if (!token) return;

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

  function resetFormForType() {
    // keep selected type, reset only the inputs
    setCreateMsg("");
    setLastDoneDate("");
    setNextDueDate("");
    setLastDoneUsage("");
    setFrequency("");
    setFrequencyUnit("hours");
    setUsageDailyAverage("");
    setUsageDailyAverageMode("manual");
  }

  useEffect(() => {
    resetFormForType();
  }, [deadlineTypeId]);

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
      last_done_date: lastDoneDate || null,
    };

    if (selectedType?.measure_by === "date") {
      if (!nextDueDate) {
        setCreateMsg("Para tipo por fecha: debes indicar next due date");
        setCreateBusy(false);
        return;
      }
      payload.next_due_date = nextDueDate;
    } else {
      // usage
      if (lastDoneUsage === "" || frequency === "") {
        setCreateMsg("Para tipo por uso: completa last done usage y frecuencia");
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
    if (!token) return;

    const valueNum = Number(usageLogValue);
    if (!Number.isFinite(valueNum)) {
      setUsageLogsMsg("Ingresa un valor numérico válido");
      setUsageLogsBusy(false);
      return;
    }

    const loggedAtIso = usageLogLoggedAt ? new Date(usageLogLoggedAt).toISOString() : new Date().toISOString();

    const res = await fetch("/api/usage-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        entity_id: entityId,
        value: valueNum,
        logged_at: loggedAtIso,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setUsageLogsMsg(json.error || "No se pudo guardar el registro de uso");
      setUsageLogsBusy(false);
      return;
    }

    setUsageLogValue("");
    setUsageLogLoggedAt(isoToLocalDatetimeInput(new Date().toISOString()));
    await loadUsageLogs();
    setUsageLogsBusy(false);
  }

  async function deleteUsageLog(id: string) {
    setUsageLogsBusy(true);
    setUsageLogsMsg("");

    const token = await getToken();
    if (!token) return;

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
      frequency_unit: d.frequency_unit ?? "hours",
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

    const payload: Record<string, unknown> = {
      id: d.id,
      last_done_date: editDraft.last_done_date || null,
    };

    if (d.deadline_types?.measure_by === "date") {
      if (!editDraft.next_due_date) {
        setEditMsg("Para vencimientos por fecha: next due date es requerido.");
        setEditBusy(false);
        return;
      }
      payload.next_due_date = editDraft.next_due_date;
    } else {
      if (editDraft.last_done_usage === "" || editDraft.frequency === "") {
        setEditMsg("Para vencimientos por uso: last done usage y frecuencia son requeridos.");
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

  const card: React.CSSProperties = {
    border: "1px solid #eee",
    borderRadius: 14,
    padding: 14,
    background: "white",
  };

  return (
    <section style={{ marginTop: 14, ...card }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
        <div>
          <h3 style={{ margin: 0 }}>Vencimientos</h3>
          <p style={{ marginTop: 6, opacity: 0.75 }}>
            Todo vencimiento se crea desde un tipo (catálogo de la organización).
          </p>
        </div>
        <button onClick={bootstrap} disabled={anyBusy || usageLogsBusy} style={{ padding: 10 }}>
          Refrescar
        </button>
      </div>

      {generalMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{generalMsg}</p>}

      {/* -------------------------- Usage Logs (Opción 1) -------------------------- */}
      {tracksUsage ? (
      <div style={{ marginTop: 12, border: "1px solid #f0f0f0", borderRadius: 12, padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div>
            <h4 style={{ margin: 0 }}>Registro de uso</h4>
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
              Estos registros alimentan el cálculo automático del promedio diario (modo auto).
            </div>
          </div>
          <button onClick={() => loadUsageLogs()} disabled={usageLogsBusy} style={{ padding: 10 }}>
            Actualizar
          </button>
        </div>

        {usageLogsMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{usageLogsMsg}</p>}

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 240px 160px", gap: 10 }}>
          <div>
            <label>Valor de uso</label>
            <input
              inputMode="decimal"
              value={usageLogValue}
              onChange={(e) => setUsageLogValue(e.target.value)}
              placeholder="Ej: 1530"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={usageLogsBusy}
            />
          </div>

          <div>
            <label>Fecha / hora</label>
            <input
              type="datetime-local"
              value={usageLogLoggedAt}
              onChange={(e) => setUsageLogLoggedAt(e.target.value)}
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={usageLogsBusy}
            />
          </div>

          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button
              onClick={createUsageLog}
              disabled={usageLogsBusy}
              style={{ padding: 10, fontWeight: 800, width: "100%" }}
            >
              {usageLogsBusy ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Últimos registros</div>
          {usageLogs.length === 0 ? (
            <div style={{ opacity: 0.7 }}>Aún no hay registros de uso para esta entidad.</div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {usageLogs.map((l) => (
                <div
                  key={l.id}
                  style={{
                    border: "1px solid #eee",
                    borderRadius: 10,
                    padding: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 900 }}>{l.value}</div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{new Date(l.logged_at).toLocaleString()}</div>
                  </div>
                  <button
                    onClick={() => deleteUsageLog(l.id)}
                    disabled={usageLogsBusy}
                    style={{ padding: "8px 10px" }}
                    title="Eliminar registro"
                  >
                    Eliminar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      ) : null}
      {/* ------------------------------------------------------------------------ */}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {types.length === 0 ? (
          <div style={{ border: "1px dashed #ddd", borderRadius: 12, padding: 12, opacity: 0.85 }}>
            <strong>No hay tipos de vencimiento disponibles.</strong>
            <div style={{ marginTop: 6, fontSize: 13 }}>
              Crea al menos un tipo de vencimiento en <code>/app/deadline-types</code> para poder agregar vencimientos a esta entidad.
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 13, opacity: 0.8 }}>
                {showCreateForm
                  ? "Completa los datos del nuevo vencimiento."
                  : "Oculto para ahorrar espacio. Ábrelo solo cuando lo necesites."}
              </div>
              <button
                onClick={() => {
                  setShowCreateForm((prev) => !prev);
                  setCreateMsg("");
                  if (showCreateForm) {
                    setDeadlineTypeId("");
                  }
                }}
                disabled={createBusy}
                style={{ padding: "8px 10px", fontWeight: 700 }}
              >
                {showCreateForm ? "Cancelar" : "Agregar vencimiento"}
              </button>
            </div>

            {showCreateForm ? (
              <>
                {createMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap", margin: 0 }}>{createMsg}</p>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 200px", gap: 10 }}>
                  <div>
                    <label>Tipo</label>
                    <select
                      value={deadlineTypeId}
                      onChange={(e) => setDeadlineTypeId(e.target.value)}
                      style={{ width: "100%", padding: 10, marginTop: 6 }}
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

                  <div>
                    <label>Última realización (opcional)</label>
                    <input
                      type="date"
                      value={lastDoneDate}
                      onChange={(e) => setLastDoneDate(e.target.value)}
                      style={{ width: "100%", padding: 10, marginTop: 6 }}
                      disabled={createBusy}
                    />
                  </div>

                  <div>
                    {selectedType?.measure_by === "date" ? (
                      <>
                        <label>Next due date</label>
                        <input
                          type="date"
                          value={nextDueDate}
                          onChange={(e) => setNextDueDate(e.target.value)}
                          style={{ width: "100%", padding: 10, marginTop: 6 }}
                          disabled={createBusy}
                        />
                      </>
                    ) : selectedType?.measure_by === "usage" ? (
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <label>Last done usage</label>
                            <input
                              inputMode="decimal"
                              value={lastDoneUsage}
                              onChange={(e) => setLastDoneUsage(e.target.value)}
                              placeholder="Ej: 1200"
                              style={{ width: "100%", padding: 10, marginTop: 6 }}
                              disabled={createBusy}
                            />
                          </div>
                          <div>
                            <label>Frecuencia</label>
                            <input
                              inputMode="decimal"
                              value={frequency}
                              onChange={(e) => setFrequency(e.target.value)}
                              placeholder="Ej: 250"
                              style={{ width: "100%", padding: 10, marginTop: 6 }}
                              disabled={createBusy}
                            />
                          </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <label>Unidad</label>
                            <select
                              value={frequencyUnit}
                              onChange={(e) => setFrequencyUnit(e.target.value)}
                              style={{ width: "100%", padding: 10, marginTop: 6 }}
                              disabled={createBusy}
                            >
                              <option value="hours">hours</option>
                              <option value="kilometers">kilometers</option>
                              <option value="days">days</option>
                              <option value="cycles">cycles</option>
                            </select>
                          </div>
                          <div>
                            <label>Promedio diario (modo)</label>
                            <select
                              value={usageDailyAverageMode}
                              onChange={(e) => setUsageDailyAverageMode(e.target.value as "manual" | "auto")}
                              style={{ width: "100%", padding: 10, marginTop: 6 }}
                              disabled={createBusy}
                            >
                              <option value="manual">Manual</option>
                              <option value="auto">Automático</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label>Promedio diario{usageDailyAverageMode === "auto" ? " (calculado por el sistema)" : ""}</label>
                          <input
                            inputMode="decimal"
                            value={usageDailyAverageMode === "manual" ? usageDailyAverage : ""}
                            onChange={(e) => setUsageDailyAverage(e.target.value)}
                            placeholder={usageDailyAverageMode === "manual" ? "Ej: 6" : "Se calculará automáticamente"}
                            style={{ width: "100%", padding: 10, marginTop: 6 }}
                            disabled={createBusy || usageDailyAverageMode === "auto"}
                          />
                          {usageDailyAverageMode === "auto" && (
                            <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                              El promedio se calcula usando los usage_logs de la entidad (backend).
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 24, fontSize: 12, opacity: 0.7 }}>
                        Selecciona un tipo para completar el resto del formulario.
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={createDeadline} disabled={createBusy || !deadlineTypeId} style={{ padding: 10, fontWeight: 800 }}>
                    {createBusy ? "Guardando..." : "Guardar vencimiento"}
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid #eee" }} />

      <h4 style={{ marginTop: 0 }}>Asignados</h4>
      {editMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap", marginTop: 8 }}>{editMsg}</p>}

      {loading ? (
        <p>Cargando...</p>
      ) : deadlines.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Esta entidad aún no tiene vencimientos.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {deadlines.map((d) => {
            const t = d.deadline_types;
            return (
              <div key={d.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>{t?.name ?? "Tipo desconocido"}</div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                      {t?.measure_by === "date" ? "por fecha" : "por uso"} ·{" "}
                      {t?.requires_document ? "requiere doc" : "sin doc"} ·{" "}
                      {new Date(d.created_at).toLocaleString()}
                    </div>
                  </div>
                  {editingDeadlineId === d.id ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => saveEditedDeadline(d)} disabled={editBusy} style={{ padding: "8px 10px" }}>
                        Guardar
                      </button>
                      <button onClick={cancelEditDeadline} disabled={editBusy} style={{ padding: "8px 10px" }}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => startEditDeadline(d)} disabled={editBusy} style={{ padding: "8px 10px" }}>
                      Editar
                    </button>
                  )}
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                    gap: 8,
                  }}
                >
                  <div>
                    <strong>Last done date:</strong>{" "}
                    {editingDeadlineId === d.id ? (
                      <input
                        type="date"
                        value={editDraft?.last_done_date ?? ""}
                        onChange={(e) =>
                          setEditDraft((prev) => (prev ? { ...prev, last_done_date: e.target.value } : prev))
                        }
                        style={{ marginLeft: 8, padding: 6 }}
                        disabled={editBusy}
                      />
                    ) : (
                      (d.last_done_date ?? "-")
                    )}
                  </div>
                  {t?.measure_by === "date" ? (
                    <div>
                      <strong>Next due date:</strong>{" "}
                      {editingDeadlineId === d.id ? (
                        <input
                          type="date"
                          value={editDraft?.next_due_date ?? ""}
                          onChange={(e) =>
                            setEditDraft((prev) => (prev ? { ...prev, next_due_date: e.target.value } : prev))
                          }
                          style={{ marginLeft: 8, padding: 6 }}
                          disabled={editBusy}
                        />
                      ) : (
                        (d.next_due_date ?? "-")
                      )}
                    </div>
                  ) : (
                    <>
                      <div>
                        <strong>Last done usage:</strong>{" "}
                        {editingDeadlineId === d.id ? (
                          <input
                            inputMode="decimal"
                            value={editDraft?.last_done_usage ?? ""}
                            onChange={(e) =>
                              setEditDraft((prev) => (prev ? { ...prev, last_done_usage: e.target.value } : prev))
                            }
                            style={{ marginLeft: 8, padding: 6 }}
                            disabled={editBusy}
                          />
                        ) : (
                          (d.last_done_usage ?? "-")
                        )}
                      </div>
                      <div>
                        <strong>Frecuencia:</strong>{" "}
                        {editingDeadlineId === d.id ? (
                          <>
                            <input
                              inputMode="decimal"
                              value={editDraft?.frequency ?? ""}
                              onChange={(e) =>
                                setEditDraft((prev) => (prev ? { ...prev, frequency: e.target.value } : prev))
                              }
                              style={{ marginLeft: 8, padding: 6, width: 90 }}
                              disabled={editBusy}
                            />
                            <select
                              value={editDraft?.frequency_unit ?? "hours"}
                              onChange={(e) =>
                                setEditDraft((prev) => (prev ? { ...prev, frequency_unit: e.target.value } : prev))
                              }
                              style={{ marginLeft: 8, padding: 6 }}
                              disabled={editBusy}
                            >
                              <option value="hours">hours</option>
                              <option value="kilometers">kilometers</option>
                              <option value="days">days</option>
                              <option value="cycles">cycles</option>
                            </select>
                          </>
                        ) : (
                          <>
                            {d.frequency ?? "-"} {d.frequency_unit ?? ""}
                          </>
                        )}
                      </div>
                      <div>
                        <strong>Promedio diario:</strong>{" "}
                        {editingDeadlineId === d.id ? (
                          <>
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
                              style={{ marginLeft: 8, padding: 6 }}
                              disabled={editBusy}
                            >
                              <option value="manual">manual</option>
                              <option value="auto">auto</option>
                            </select>
                            <input
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
                              style={{ marginLeft: 8, padding: 6, width: 90 }}
                              disabled={editBusy || (editDraft?.usage_daily_average_mode ?? "manual") === "auto"}
                            />
                          </>
                        ) : (
                          <>
                            {d.usage_daily_average ?? "-"}{" "}
                            <span style={{ opacity: 0.75 }}>
                              ({(d.usage_daily_average_mode ?? "manual") === "auto" ? "auto" : "manual"})
                            </span>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
