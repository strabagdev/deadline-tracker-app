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
  created_at: string;
  deadline_types?: {
    id: string;
    name: string;
    measure_by: "date" | "usage";
    requires_document: boolean;
    is_active: boolean;
  } | null;
};

async function getToken() {
  const { data } = await supabaseAuth.auth.getSession();
  return data.session?.access_token ?? null;
}

export default function EntityDeadlinesManager({ entityId }: { entityId: string }) {
  const [types, setTypes] = useState<DeadlineType[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>("");

  // form
  const [deadlineTypeId, setDeadlineTypeId] = useState<string>("");
  const selectedType = useMemo(() => types.find((t) => t.id === deadlineTypeId) || null, [types, deadlineTypeId]);

  const [lastDoneDate, setLastDoneDate] = useState<string>("");
  const [nextDueDate, setNextDueDate] = useState<string>("");

  const [lastDoneUsage, setLastDoneUsage] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("");
  const [frequencyUnit, setFrequencyUnit] = useState<string>("hours");
  const [usageDailyAverage, setUsageDailyAverage] = useState<string>("");

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function bootstrap() {
    setLoading(true);
    setMsg("");
    await Promise.all([loadTypes(), loadDeadlines()]);
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
      setMsg(json.error || "No se pudieron cargar los tipos");
      setTypes([]);
      return;
    }
    const list: DeadlineType[] = json.deadline_types ?? [];
    setTypes(list);
    if (!deadlineTypeId && list.length > 0) setDeadlineTypeId(list[0].id);
  }

  async function loadDeadlines() {
    const token = await getToken();
    if (!token) return;

    const res = await fetch(`/api/deadlines?entity_id=${encodeURIComponent(entityId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudieron cargar los vencimientos");
      setDeadlines([]);
      return;
    }
    setDeadlines(json.deadlines ?? []);
  }

  function resetFormForType(type: DeadlineType | null) {
    // keep selected type, reset only the inputs
    setMsg("");
    setLastDoneDate("");
    setNextDueDate("");
    setLastDoneUsage("");
    setFrequency("");
    setFrequencyUnit("hours");
    setUsageDailyAverage("");
  }

  useEffect(() => {
    resetFormForType(selectedType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineTypeId]);

  async function createDeadline() {
    if (!deadlineTypeId) {
      setMsg("Debes seleccionar un tipo de vencimiento");
      return;
    }

    setBusy(true);
    setMsg("");

    const token = await getToken();
    if (!token) return;

    const payload: any = {
      entity_id: entityId,
      deadline_type_id: deadlineTypeId,
      last_done_date: lastDoneDate || null,
    };

    if (selectedType?.measure_by === "date") {
      if (!nextDueDate) {
        setMsg("Para tipo por fecha: debes indicar next due date");
        setBusy(false);
        return;
      }
      payload.next_due_date = nextDueDate;
    } else {
      // usage
      if (lastDoneUsage === "" || frequency === "" || usageDailyAverage === "") {
        setMsg("Para tipo por uso: completa last done usage, frecuencia y promedio diario");
        setBusy(false);
        return;
      }
      payload.last_done_usage = Number(lastDoneUsage);
      payload.frequency = Number(frequency);
      payload.frequency_unit = frequencyUnit;
      payload.usage_daily_average = Number(usageDailyAverage);
    }

    const res = await fetch("/api/deadlines", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(json.error || "No se pudo crear el vencimiento");
      setBusy(false);
      return;
    }

    await loadDeadlines();
    setBusy(false);
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
        <button onClick={bootstrap} disabled={busy} style={{ padding: 10 }}>
          Refrescar
        </button>
      </div>

      {msg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{msg}</p>}

      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 200px 200px", gap: 10 }}>
          <div>
            <label>Tipo</label>
            <select
              value={deadlineTypeId}
              onChange={(e) => setDeadlineTypeId(e.target.value)}
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            >
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
              disabled={busy}
            />
          </div>

          {selectedType?.measure_by === "date" ? (
            <div>
              <label>Next due date</label>
              <input
                type="date"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                disabled={busy}
              />
            </div>
          ) : (
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
                    disabled={busy}
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
                    disabled={busy}
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
                    disabled={busy}
                  >
                    <option value="hours">hours</option>
                    <option value="kilometers">kilometers</option>
                    <option value="days">days</option>
                    <option value="cycles">cycles</option>
                  </select>
                </div>
                <div>
                  <label>Promedio diario</label>
                  <input
                    inputMode="decimal"
                    value={usageDailyAverage}
                    onChange={(e) => setUsageDailyAverage(e.target.value)}
                    placeholder="Ej: 6"
                    style={{ width: "100%", padding: 10, marginTop: 6 }}
                    disabled={busy}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={createDeadline} disabled={busy || !deadlineTypeId} style={{ padding: 10, fontWeight: 800 }}>
            {busy ? "Guardando..." : "Agregar vencimiento"}
          </button>
        </div>
      </div>

      <hr style={{ margin: "14px 0", border: "none", borderTop: "1px solid #eee" }} />

      <h4 style={{ marginTop: 0 }}>Asignados</h4>

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
                </div>

                <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8 }}>
                  <div><strong>Last done date:</strong> {d.last_done_date ?? "-"}</div>
                  {t?.measure_by === "date" ? (
                    <div><strong>Next due date:</strong> {d.next_due_date ?? "-"}</div>
                  ) : (
                    <>
                      <div><strong>Last done usage:</strong> {d.last_done_usage ?? "-"}</div>
                      <div><strong>Frecuencia:</strong> {d.frequency ?? "-"} {d.frequency_unit ?? ""}</div>
                      <div><strong>Promedio diario:</strong> {d.usage_daily_average ?? "-"}</div>
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
