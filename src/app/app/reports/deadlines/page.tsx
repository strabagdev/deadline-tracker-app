"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/PageHero";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toCsv } from "@/lib/csv/simpleCsv";

type ReportStatus = "green" | "yellow" | "orange" | "red";

type Row = {
  organization_id: string;
  entity_id: string;
  entity_name: string;
  entity_type_name: string;
  tracks_usage: boolean;
  deadline_id: string;
  deadline_type_name: string;
  measure_by: "date" | "usage";
  status: ReportStatus;
  next_due_date: string | null;
  days_to_due: number | null;
  last_done_date: string | null;
  current_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  usage_remaining: number | null;
  projected_due_date: string | null;
  updated_at: string;
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function formatNumber(value: number | null) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-CL", { maximumFractionDigits: 2 }).format(value);
}

function statusBadgeClass(status: ReportStatus) {
  if (status === "red") return "border-rose-300 bg-rose-100 text-rose-800";
  if (status === "orange") return "border-orange-300 bg-orange-100 text-orange-800";
  if (status === "yellow") return "border-amber-300 bg-amber-100 text-amber-800";
  return "border-emerald-300 bg-emerald-100 text-emerald-800";
}

function statusPriority(status: ReportStatus) {
  if (status === "red") return 0;
  if (status === "orange") return 1;
  if (status === "yellow") return 2;
  return 3;
}

function buildCsv(rows: Row[]) {
  return toCsv([
    [
      "entity_name",
      "entity_type_name",
      "deadline_type_name",
      "measure_by",
      "status",
      "next_due_date",
      "days_to_due",
      "last_done_date",
      "current_usage",
      "frequency",
      "frequency_unit",
      "usage_daily_average",
      "usage_remaining",
      "projected_due_date",
      "updated_at",
    ],
    ...rows.map((row) => [
      row.entity_name,
      row.entity_type_name,
      row.deadline_type_name,
      row.measure_by,
      row.status,
      row.next_due_date ?? "",
      row.days_to_due != null ? String(row.days_to_due) : "",
      row.last_done_date ?? "",
      row.current_usage != null ? String(row.current_usage) : "",
      row.frequency != null ? String(row.frequency) : "",
      row.frequency_unit ?? "",
      row.usage_daily_average != null ? String(row.usage_daily_average) : "",
      row.usage_remaining != null ? String(row.usage_remaining) : "",
      row.projected_due_date ?? "",
      row.updated_at,
    ]),
  ]);
}

export default function DeadlineReportsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReportStatus | "all">("all");
  const [measureFilter, setMeasureFilter] = useState<"all" | "date" | "usage">("all");
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return null;
    }
    return token;
  }

  async function load() {
    setLoading(true);
    setErrorMsg("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

    const res = await fetch("/api/reporting/deadlines", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => []);
    if (!res.ok) {
      const error = json && typeof json === "object" && "error" in json ? String((json as { error?: unknown }).error ?? "") : "";
      setErrorMsg(error || "No se pudo cargar reportabilidad de vencimientos.");
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(Array.isArray(json) ? (json as Row[]) : []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entityTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.entity_type_name) map.set(row.entity_type_name, row.entity_type_name);
    }
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (statusFilter !== "all" && row.status !== statusFilter) return false;
        if (measureFilter !== "all" && row.measure_by !== measureFilter) return false;
        if (entityTypeFilter !== "all" && row.entity_type_name !== entityTypeFilter) return false;
        if (!needle) return true;
        return [
          row.entity_name,
          row.entity_type_name,
          row.deadline_type_name,
          row.measure_by,
          row.status,
        ].some((value) => String(value ?? "").toLowerCase().includes(needle));
      })
      .sort((a, b) => {
        const statusDiff = statusPriority(a.status) - statusPriority(b.status);
        if (statusDiff !== 0) return statusDiff;
        const aDue = new Date(a.projected_due_date ?? a.next_due_date ?? "9999-12-31").getTime();
        const bDue = new Date(b.projected_due_date ?? b.next_due_date ?? "9999-12-31").getTime();
        if (aDue !== bDue) return aDue - bDue;
        return a.entity_name.localeCompare(b.entity_name, "es", { sensitivity: "base" });
      });
  }, [entityTypeFilter, measureFilter, q, rows, statusFilter]);

  const summary = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.status] += 1;
        return acc;
      },
      { total: 0, green: 0, yellow: 0, orange: 0, red: 0 }
    );
  }, [filteredRows]);

  function downloadCsv() {
    setBusy(true);
    const blob = new Blob([buildCsv(filteredRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "deadline_reports.csv";
    link.click();
    URL.revokeObjectURL(url);
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-4 sm:space-y-6">
      <PageHero
        badge="Reportes"
        secondaryBadge="Vencimientos"
        title="Reportes de vencimientos"
        subtitle="Vista reportable del estado vigente por entidad y vencimiento."
        actions={
          <>
            <Button onClick={() => void downloadCsv()} variant="outline" size="sm" disabled={loading || busy}>
              Exportar CSV
            </Button>
            <Link href="/app/forecast">
              <Button variant="outline" size="sm">Forecast</Button>
            </Link>
            <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>
              Refrescar
            </Button>
          </>
        }
      />

      {errorMsg ? <div className="app-alert app-alert-error whitespace-pre-wrap">{errorMsg}</div> : null}

      <div className="grid gap-3 md:grid-cols-5">
        <Card><CardContent className="pt-5"><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-semibold text-slate-900">{summary.total}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs text-slate-500">Rojo</div><div className="text-2xl font-semibold text-rose-700">{summary.red}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs text-slate-500">Naranjo</div><div className="text-2xl font-semibold text-orange-700">{summary.orange}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs text-slate-500">Amarillo</div><div className="text-2xl font-semibold text-amber-700">{summary.yellow}</div></CardContent></Card>
        <Card><CardContent className="pt-5"><div className="text-xs text-slate-500">Verde</div><div className="text-2xl font-semibold text-emerald-700">{summary.green}</div></CardContent></Card>
      </div>

      <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_180px_180px_220px_auto]">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por entidad, tipo o vencimiento..."
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ReportStatus | "all")}
              className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
            >
              <option value="all">Todos los estados</option>
              <option value="red">Rojo</option>
              <option value="orange">Naranjo</option>
              <option value="yellow">Amarillo</option>
              <option value="green">Verde</option>
            </select>
            <select
              value={measureFilter}
              onChange={(e) => setMeasureFilter(e.target.value as "all" | "date" | "usage")}
              className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
            >
              <option value="all">Fecha y uso</option>
              <option value="date">Por fecha</option>
              <option value="usage">Por uso</option>
            </select>
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
            >
              <option value="all">Todos los tipos</option>
              {entityTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              onClick={() => {
                setQ("");
                setStatusFilter("all");
                setMeasureFilter("all");
                setEntityTypeFilter("all");
              }}
            >
              Limpiar
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-4">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center py-6">
            <Loader label="Cargando reportes de vencimientos..." />
          </div>
        ) : filteredRows.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="app-empty">No hay vencimientos para mostrar con estos filtros.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-2xl border bg-white">
            <div className="grid min-w-[1120px] grid-cols-[1.2fr_1fr_0.8fr_0.85fr_1fr_1fr_1fr] border-b bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
              <div>Entidad</div>
              <div>Vencimiento</div>
              <div>Estado</div>
              <div>Modo</div>
              <div>Próxima fecha</div>
              <div>Uso / frecuencia</div>
              <div>Proyección</div>
            </div>
            {filteredRows.map((row) => (
              <div
                key={row.deadline_id}
                className="grid min-w-[1120px] grid-cols-[1.2fr_1fr_0.8fr_0.85fr_1fr_1fr_1fr] items-center border-b px-3 py-2 text-[13px]"
              >
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-900">{row.entity_name}</div>
                  <div className="truncate text-[11px] text-slate-500">{row.entity_type_name}</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">{row.deadline_type_name}</div>
                  <div className="truncate text-[11px] text-slate-500">{formatDate(row.last_done_date)}</div>
                </div>
                <div>
                  <Badge variant="outline" className={cn("font-semibold", statusBadgeClass(row.status))}>
                    {row.status}
                  </Badge>
                </div>
                <div className="text-slate-700">{row.measure_by === "usage" ? "Por uso" : "Por fecha"}</div>
                <div className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {row.measure_by === "usage" ? formatDate(row.projected_due_date) : formatDate(row.next_due_date)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {row.days_to_due != null ? `${row.days_to_due} día(s)` : "Sin cálculo por fecha"}
                  </div>
                </div>
                <div className="min-w-0 text-slate-700">
                  {row.measure_by === "usage" ? (
                    <>
                      <div>Actual: {formatNumber(row.current_usage)}</div>
                      <div className="text-[11px] text-slate-500">
                        Frec.: {formatNumber(row.frequency)} {row.frequency_unit ?? ""}
                      </div>
                    </>
                  ) : (
                    <span className="text-[11px] text-slate-500">No aplica</span>
                  )}
                </div>
                <div className="min-w-0 text-slate-700">
                  {row.measure_by === "usage" ? (
                    <>
                      <div>Restante: {formatNumber(row.usage_remaining)}</div>
                      <div className="text-[11px] text-slate-500">
                        Prom.: {formatNumber(row.usage_daily_average)} / día
                      </div>
                    </>
                  ) : (
                    <span className="text-[11px] text-slate-500">Sin proyección de uso</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
