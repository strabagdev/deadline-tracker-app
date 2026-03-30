"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHero } from "@/components/PageHero";
import { cn } from "@/lib/utils";

type Scale = "month" | "quarter" | "year";

type Option = {
  id: string;
  name: string;
};

type GanttRow = {
  entity_id: string;
  entity_name: string;
  entity_type_id: string | null;
  entity_type_name: string;
  deadline_id: string;
  deadline_type_id: string | null;
  deadline_type_name: string;
  measure_by: "date" | "usage";
  start_date: string;
  end_date: string;
  forecast_due_date: string | null;
  last_done_date: string | null;
  next_due_date: string | null;
  days_remaining: number | null;
  risk_level: "green" | "yellow" | "orange" | "red" | "none";
  risk_score: number;
  computed_at: string;
};

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function startOfQuarter(date: Date) {
  const month = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), month, 1);
}

function endOfQuarter(date: Date) {
  const start = startOfQuarter(date);
  return new Date(start.getFullYear(), start.getMonth() + 3, 0);
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

function endOfYear(date: Date) {
  return new Date(date.getFullYear(), 11, 31);
}

function parseDate(raw: string) {
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : new Date(NaN);
}

function fmtDate(raw: string | null) {
  if (!raw) return "—";
  const date = parseDate(raw);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function riskBadgeClass(level: string) {
  if (level === "red") return "border-rose-300 bg-rose-100 text-rose-800";
  if (level === "orange") return "border-orange-300 bg-orange-100 text-orange-800";
  if (level === "yellow") return "border-amber-300 bg-amber-100 text-amber-800";
  if (level === "none") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-emerald-300 bg-emerald-100 text-emerald-800";
}

function getRange(anchor: Date, scale: Scale) {
  if (scale === "month") {
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }
  if (scale === "quarter") {
    return { start: startOfQuarter(anchor), end: endOfQuarter(anchor) };
  }
  return { start: startOfYear(anchor), end: endOfYear(anchor) };
}

function shiftAnchor(anchor: Date, scale: Scale, delta: number) {
  if (scale === "month") return addMonths(anchor, delta);
  if (scale === "quarter") return addMonths(anchor, delta * 3);
  return new Date(anchor.getFullYear() + delta, 0, 1);
}

function getColumns(anchor: Date, scale: Scale) {
  if (scale === "month") {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    const days = end.getDate();
    return Array.from({ length: days }, (_, idx) => {
      const date = new Date(start.getFullYear(), start.getMonth(), idx + 1);
      return {
        key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
        label: String(idx + 1),
        shortLabel: date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
        start: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0),
        end: new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999),
      };
    });
  }

  const months = scale === "quarter" ? 3 : 12;
  const start = scale === "quarter" ? startOfQuarter(anchor) : startOfYear(anchor);
  return Array.from({ length: months }, (_, idx) => {
    const date = new Date(start.getFullYear(), start.getMonth() + idx, 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: date.toLocaleDateString(undefined, { month: "short" }),
      shortLabel: date.toLocaleDateString(undefined, { month: "short" }),
      start: new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0),
      end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  });
}

function getPeriodLabel(anchor: Date, scale: Scale) {
  if (scale === "month") {
    return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  if (scale === "quarter") {
    const quarter = Math.floor(anchor.getMonth() / 3) + 1;
    return `Q${quarter} ${anchor.getFullYear()}`;
  }
  return String(anchor.getFullYear());
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

function getFriendlyFetchError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/fetch failed|econnreset|failed to fetch/i.test(message)) {
    return "La conexión con el servidor se interrumpió mientras se cargaba la carta Gantt. Intenta nuevamente.";
  }
  return message;
}

export default function ForecastGanttPage() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [rows, setRows] = useState<GanttRow[]>([]);
  const [entityOptions, setEntityOptions] = useState<Option[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<Option[]>([]);
  const [deadlineTypeOptions, setDeadlineTypeOptions] = useState<Option[]>([]);
  const [entityId, setEntityId] = useState("all");
  const [entityTypeId, setEntityTypeId] = useState("all");
  const [deadlineTypeId, setDeadlineTypeId] = useState("all");
  const [scale, setScale] = useState<Scale>("month");
  const [anchor, setAnchor] = useState(() => new Date());

  async function load() {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data } = await supabaseAuth.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        window.location.href = "/login";
        return;
      }

      const params = new URLSearchParams();
      if (entityId !== "all") params.set("entity_id", entityId);
      if (entityTypeId !== "all") params.set("entity_type_id", entityTypeId);
      if (deadlineTypeId !== "all") params.set("deadline_type_id", deadlineTypeId);

      const res = await fetch(`/api/forecasts/gantt?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          json && typeof json === "object" && "error" in json ? String(json.error ?? "").trim() : "";
        setErrorMsg(message || "No se pudo cargar la carta Gantt.");
        setRows([]);
        setEntityOptions([]);
        setEntityTypeOptions([]);
        setDeadlineTypeOptions([]);
        setLoading(false);
        return;
      }

      setRows(Array.isArray(json.rows) ? json.rows : []);
      setEntityOptions(Array.isArray(json.options?.entities) ? json.options.entities : []);
      setEntityTypeOptions(Array.isArray(json.options?.entity_types) ? json.options.entity_types : []);
      setDeadlineTypeOptions(Array.isArray(json.options?.deadline_types) ? json.options.deadline_types : []);
    } catch (error) {
      setErrorMsg(getFriendlyFetchError(error, "No se pudo cargar la carta Gantt."));
      setRows([]);
      setEntityOptions([]);
      setEntityTypeOptions([]);
      setDeadlineTypeOptions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, entityTypeId, deadlineTypeId]);

  const range = useMemo(() => getRange(anchor, scale), [anchor, scale]);
  const columns = useMemo(() => getColumns(anchor, scale), [anchor, scale]);
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();
  const totalMs = Math.max(1, rangeEnd - rangeStart);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      const start = parseDate(row.start_date).getTime();
      const end = parseDate(row.end_date).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      return end >= rangeStart && start <= rangeEnd;
    });
  }, [rangeEnd, rangeStart, rows]);

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4">
      <PageHero
        badge="Forecast"
        secondaryBadge="Gantt"
        title="Carta Gantt de vencimientos"
        subtitle="Seguimiento temporal desde última ejecución hasta vencimiento proyectado."
        density="compact"
        actions={
          <Link href="/app/forecast">
            <Button variant="outline" size="sm">Volver a Forecast</Button>
          </Link>
        }
      />

      <Card className="sticky top-24 z-20 bg-white/95 shadow-sm backdrop-blur">
        <CardContent className="grid gap-3 py-4 md:grid-cols-3 xl:grid-cols-6">
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm">
            <option value="all">Todas las entidades</option>
            {entityOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <select value={entityTypeId} onChange={(e) => setEntityTypeId(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm">
            <option value="all">Todos los tipos</option>
            {entityTypeOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <select value={deadlineTypeId} onChange={(e) => setDeadlineTypeId(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm">
            <option value="all">Todos los vencimientos</option>
            {deadlineTypeOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.name}</option>
            ))}
          </select>
          <select value={scale} onChange={(e) => setScale(e.target.value as Scale)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm">
            <option value="month">Mensual</option>
            <option value="quarter">Trimestral</option>
            <option value="year">Anual</option>
          </select>
          <div className="flex items-center gap-2 xl:col-span-2">
            <Button variant="outline" size="sm" onClick={() => setAnchor((prev) => shiftAnchor(prev, scale, -1))}>Anterior</Button>
            <div className="min-w-[180px] text-center text-sm font-semibold text-slate-700">{getPeriodLabel(anchor, scale)}</div>
            <Button variant="outline" size="sm" onClick={() => setAnchor((prev) => shiftAnchor(prev, scale, 1))}>Siguiente</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>Hoy</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader label="Construyendo carta Gantt..." />
        </div>
      ) : errorMsg ? (
        <Card>
          <CardContent className="py-4">
            <div className="app-alert app-alert-error">{errorMsg}</div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Vista temporal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {visibleRows.length === 0 ? (
              <p className="app-empty">No hay vencimientos que crucen el periodo y filtros seleccionados.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <div
                  className="grid min-w-[1200px] border-b bg-slate-50"
                  style={{ gridTemplateColumns: `280px 180px minmax(700px, 1fr)` }}
                >
                  <div className="border-r px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Entidad / vencimiento</div>
                  <div className="border-r px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Detalle</div>
                  <div className="grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
                    {columns.map((column) => (
                      <div key={column.key} className="border-l px-2 py-2 text-center text-[11px] text-slate-500">
                        <div>{column.label}</div>
                        {scale === "month" ? <div className="text-[10px] text-slate-400">{column.shortLabel}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>

                {visibleRows.map((row) => {
                  const start = parseDate(row.start_date).getTime();
                  const end = parseDate(row.end_date).getTime();
                  const clippedStart = Math.max(start, rangeStart);
                  const clippedEnd = Math.min(end, rangeEnd);
                  const left = clampPct(((clippedStart - rangeStart) / totalMs) * 100);
                  const width = clampPct(((Math.max(clippedEnd, clippedStart) - clippedStart) / totalMs) * 100);
                  const marker = clampPct(((Math.min(Math.max(end, rangeStart), rangeEnd) - rangeStart) / totalMs) * 100);

                  return (
                    <div
                      key={`${row.entity_id}-${row.deadline_id}`}
                      className="grid min-w-[1200px] border-b last:border-b-0"
                      style={{ gridTemplateColumns: `280px 180px minmax(700px, 1fr)` }}
                    >
                      <div className="border-r px-3 py-3">
                        <div className="truncate text-sm font-semibold text-slate-900">{row.entity_name}</div>
                        <div className="truncate text-xs text-slate-500">{row.entity_type_name}</div>
                        <div className="mt-1 truncate text-xs text-slate-700">{row.deadline_type_name}</div>
                      </div>
                      <div className="border-r px-3 py-3 text-xs text-slate-600">
                        <div className="mb-1">
                          <Badge variant="outline" className={riskBadgeClass(row.risk_level)}>
                            {row.risk_level}
                          </Badge>
                        </div>
                        <div>Inicio: {fmtDate(row.start_date)}</div>
                        <div>Fin: {fmtDate(row.end_date)}</div>
                        <div>{row.measure_by === "date" ? "Por fecha" : "Por uso"}</div>
                      </div>
                      <div className="px-3 py-3">
                        <div className="relative h-14 rounded-xl bg-slate-50">
                          <div className="absolute inset-y-0 left-0 right-0 grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
                            {columns.map((column) => (
                              <div key={column.key} className="border-l border-slate-200 first:border-l-0" />
                            ))}
                          </div>
                          <div
                            className={cn(
                              "absolute top-4 h-6 rounded-full border px-3 text-xs font-medium leading-6 shadow-sm",
                              row.risk_level === "red" && "border-rose-300 bg-rose-100 text-rose-800",
                              row.risk_level === "orange" && "border-orange-300 bg-orange-100 text-orange-800",
                              row.risk_level === "yellow" && "border-amber-300 bg-amber-100 text-amber-800",
                              row.risk_level === "green" && "border-emerald-300 bg-emerald-100 text-emerald-800",
                              row.risk_level === "none" && "border-slate-300 bg-slate-100 text-slate-700"
                            )}
                            style={{ left: `${left}%`, width: `${Math.max(width, 2)}%` }}
                          >
                            <span className="truncate">{row.deadline_type_name}</span>
                          </div>
                          <div className="absolute top-2 bottom-2 w-px bg-slate-900/40" style={{ left: `${marker}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
