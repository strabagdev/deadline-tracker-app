"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ForecastSummary = {
  upcoming_7_days: number;
  upcoming_30_days: number;
  total_forecasts: number;
  total_entities?: number;
};

type ForecastEntity = {
  entity_id: string;
  entity_name: string;
  entity_type_id: string | null;
  entity_type_name: string;
  deadline_id: string;
  deadline_name: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: "green" | "yellow" | "orange" | "red" | "none";
  risk_score: number;
};

type ForecastEvent = {
  id: string;
  entity_name?: string;
  deadline_name?: string;
  severity: "red" | "orange" | "yellow" | "green" | "none" | string;
  message: string;
  last_seen_at: string;
  resolved_at: string | null;
};

type Status = "red" | "orange" | "yellow" | "green" | "none";
type StatusLabels = {
  red: string;
  orange: string;
  yellow: string;
  green: string;
  none: string;
};

function riskBadgeClass(level: string) {
  if (level === "red") return "border-rose-300 bg-rose-100 text-rose-800";
  if (level === "orange") return "border-orange-300 bg-orange-100 text-orange-800";
  if (level === "yellow") return "border-amber-300 bg-amber-100 text-amber-800";
  if (level === "none") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-emerald-300 bg-emerald-100 text-emerald-800";
}

function statusLabel(level: string, labels: StatusLabels) {
  if (level === "red") return labels.red;
  if (level === "orange") return labels.orange;
  if (level === "yellow") return labels.yellow;
  if (level === "green") return labels.green;
  if (level === "none") return labels.none;
  return level;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function statusPriority(s: Status) {
  if (s === "red") return 0;
  if (s === "orange") return 1;
  if (s === "yellow") return 2;
  if (s === "green") return 3;
  return 4;
}

export default function ForecastPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [summary, setSummary] = useState<ForecastSummary>({
    upcoming_7_days: 0,
    upcoming_30_days: 0,
    total_forecasts: 0,
    total_entities: 0,
  });
  const [rows, setRows] = useState<ForecastEntity[]>([]);
  const [computedAt, setComputedAt] = useState<string>("");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [q, setQ] = useState("");
  const [labels, setLabels] = useState<StatusLabels>({
    red: "Vencido",
    orange: "Por vencer",
    yellow: "Aviso",
    green: "Al día",
    none: "Sin info",
  });
  const [showEvents, setShowEvents] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [activeEvents, setActiveEvents] = useState<ForecastEvent[]>([]);
  const [resolvedEvents, setResolvedEvents] = useState<ForecastEvent[]>([]);
  const [eventsSummary, setEventsSummary] = useState<{ active: number; resolved_recent: number }>({
    active: 0,
    resolved_recent: 0,
  });

  async function loadForecasts() {
    setLoading(true);
    setErrorMsg("");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setLoading(false);
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/forecasts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar forecast");
      setLoading(false);
      return;
    }

    setSummary(json.summary ?? summary);
    setRows(Array.isArray(json.entities) ? json.entities : []);
    setComputedAt(String(json.computed_at ?? ""));
    if (json?.labels) {
      setLabels({
        red: String(json.labels.red ?? "Vencido"),
        orange: String(json.labels.orange ?? "Por vencer"),
        yellow: String(json.labels.yellow ?? "Aviso"),
        green: String(json.labels.green ?? "Al día"),
        none: String(json.labels.none ?? "Sin info"),
      });
    }

    setLoading(false);
  }

  async function loadEvents() {
    setEventsLoading(true);
    setEventsError("");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setEventsLoading(false);
      return;
    }

    const res = await fetch("/api/alert-events", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));

    if (res.status === 403) {
      setEventsSummary({ active: 0, resolved_recent: 0 });
      setActiveEvents([]);
      setResolvedEvents([]);
      setEventsLoading(false);
      return;
    }

    if (!res.ok) {
      setEventsError(json.error || "No se pudo cargar el historial de eventos.");
      setEventsLoading(false);
      return;
    }

    setEventsSummary(json.summary ?? { active: 0, resolved_recent: 0 });
    setActiveEvents(Array.isArray(json.active) ? json.active : []);
    setResolvedEvents(Array.isArray(json.recent_resolved) ? json.recent_resolved : []);
    setEventsLoading(false);
  }

  async function recompute() {
    setBusy(true);
    setErrorMsg("");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setBusy(false);
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/forecasts/recompute", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo recomputar forecast");
      setBusy(false);
      return;
    }

    await loadForecasts();
    setBusy(false);
  }

  useEffect(() => {
    void loadForecasts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showEvents) return;
    if (eventsLoading) return;
    if (activeEvents.length > 0 || resolvedEvents.length > 0 || eventsError) return;
    void loadEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showEvents]);

  const orderedRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (filterEntityType !== "all" && r.entity_type_id !== filterEntityType) return false;
      if (!needle) return true;
      const entity = r.entity_name.toLowerCase();
      const type = (r.entity_type_name ?? "").toLowerCase();
      const deadline = r.deadline_name.toLowerCase();
      return entity.includes(needle) || type.includes(needle) || deadline.includes(needle);
    });
    return [...filtered].sort((a, b) => {
      const pa = statusPriority(a.risk_level);
      const pb = statusPriority(b.risk_level);
      if (pa !== pb) return pa - pb;
      const da = a.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const db = b.days_remaining ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.entity_name.localeCompare(b.entity_name);
    });
  }, [filterEntityType, q, rows]);

  const entityTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) {
      if (r.entity_type_id) map.set(r.entity_type_id, r.entity_type_name || "Sin tipo");
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [rows]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>OpsAhead Forecast</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Motor precalculado principal para vencimientos, riesgo y estado operativo.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app/forecast/gantt">
                <Button variant="outline" size="sm">Carta Gantt</Button>
              </Link>
              <Link href="/app">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <Button onClick={() => void recompute()} disabled={busy} size="sm">
                {busy ? "Recomputando..." : "Recomputar"}
              </Button>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            {computedAt ? `Último cálculo: ${new Date(computedAt).toLocaleString()}` : "Sin cálculo reciente"}
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}

      {loading ? (
        <div className="flex min-h-[60vh] items-center justify-center py-8">
          <Loader label="Calculando pronósticos..." />
        </div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos 7 días</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.upcoming_7_days}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos 30 días</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.upcoming_30_days}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Entidades</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.total_entities ?? rows.length}</div></CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Eventos derivados</CardTitle>
                  <p className="mt-1 text-sm text-slate-500">
                    Historial auxiliar generado desde el mismo motor precalculado de forecast.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-slate-500">
                    Activos: <b>{eventsSummary.active}</b> · Cerrados recientes: <b>{eventsSummary.resolved_recent}</b>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowEvents((v) => !v)}>
                    {showEvents ? "Ocultar" : "Ver eventos"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {showEvents ? (
              <CardContent className="space-y-3 pt-0">
                {eventsLoading ? <Loader label="Cargando eventos..." /> : null}
                {eventsError ? <p className="text-sm text-rose-600">{eventsError}</p> : null}
                {!eventsLoading && !eventsError ? (
                  <>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-slate-800">Activos</div>
                        {activeEvents.length === 0 ? (
                          <p className="text-sm text-slate-500">Sin eventos activos.</p>
                        ) : (
                          activeEvents.slice(0, 10).map((event) => (
                            <div key={event.id} className="rounded-xl border bg-slate-50 px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className={riskBadgeClass(event.severity)}>
                                  {statusLabel(event.severity, labels)}
                                </Badge>
                                {event.entity_name ? <Badge variant="outline">{event.entity_name}</Badge> : null}
                                {event.deadline_name ? <Badge variant="outline">{event.deadline_name}</Badge> : null}
                                <span className="text-xs text-slate-500">
                                  Última detección: {new Date(event.last_seen_at).toLocaleString()}
                                </span>
                              </div>
                              <p className="mt-1 text-sm text-slate-700">{event.message}</p>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-semibold text-slate-800">Cerrados recientes</div>
                        {resolvedEvents.length === 0 ? (
                          <p className="text-sm text-slate-500">Sin eventos cerrados recientes.</p>
                        ) : (
                          resolvedEvents.slice(0, 10).map((event) => (
                            <div key={event.id} className="rounded-xl border bg-white px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className={cn(riskBadgeClass(event.severity), "opacity-80")}>
                                  {statusLabel(event.severity, labels)}
                                </Badge>
                                <span className="text-sm text-slate-700">{event.message}</span>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      Esta sección es secundaria. El estado vigente y accionable vive en la tabla principal de forecast.
                    </div>
                  </>
                ) : null}
              </CardContent>
            ) : null}
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Por entidad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_220px]">
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por entidad, tipo o vencimiento..."
                  className="h-10"
                />
                <select
                  aria-label="Filtrar por tipo de entidad"
                  value={filterEntityType}
                  onChange={(e) => setFilterEntityType(e.target.value)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="all">Todos los tipos</option>
                  {entityTypeOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              {orderedRows.length === 0 ? (
                <p className="text-sm text-slate-500">No hay datos de forecast para mostrar.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <div className="grid min-w-[860px] grid-cols-[1.35fr_1.05fr_0.9fr_0.85fr_0.7fr_0.65fr] border-b bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    <div>Entidad</div>
                    <div>Próximo vencimiento</div>
                    <div>Fecha estimada</div>
                    <div>Días restantes</div>
                    <div>Puntaje</div>
                    <div>Estado</div>
                  </div>
                  {orderedRows.map((r) => (
                    <div key={`${r.entity_id}-${r.deadline_id}`} className="grid min-w-[860px] grid-cols-[1.35fr_1.05fr_0.9fr_0.85fr_0.7fr_0.65fr] items-center border-b px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <Link href={`/app/entities/${r.entity_id}`} className="truncate font-semibold text-slate-900 hover:underline">
                          {r.entity_name}
                        </Link>
                        <div className="truncate text-[11px] text-slate-500">{r.entity_type_name || "Sin tipo"}</div>
                      </div>
                      <div className="truncate text-slate-700">{r.deadline_name}</div>
                      <div className="text-slate-700">{r.forecast_due_date ? fmtDate(r.forecast_due_date) : "Sin fecha estimada"}</div>
                      <div className="text-slate-700">{r.days_remaining ?? "Sin info"}</div>
                      <div className="text-slate-700">{Math.round(Number(r.risk_score ?? 0))}</div>
                      <div>
                        <Badge variant="outline" className={riskBadgeClass(r.risk_level)}>
                          {statusLabel(r.risk_level, labels)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </>
      )}
    </main>
  );
}
