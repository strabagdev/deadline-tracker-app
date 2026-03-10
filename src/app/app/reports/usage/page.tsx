"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MarkedDatePicker } from "@/components/marked-date-picker";
import { toCsv } from "@/lib/csv/simpleCsv";
import { csvToSpreadsheetXml } from "@/lib/csv/spreadsheetXml";

type Row = {
  id: string;
  entity_id: string;
  entity_name: string;
  entity_type_id: string | null;
  entity_type_name: string;
  usage_unit_name: string;
  usage_unit_visible?: boolean;
  logged_on: string;
  logged_at: string;
  value: number | null;
  value_text: string | null;
  value_display: string;
  entity_profile_values: Array<{ entity_field_id?: string; name: string; value: string }>;
  field_values: Array<{ usage_field_id: string; name: string; value: string }>;
};

type TypeOption = { id: string; name: string };

function todayInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatBusinessDate(dateText: string) {
  return String(dateText ?? "").trim() || "—";
}

function escapeHtml(v: string) {
  return v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildPrintHtml(
  rows: Row[],
  entityProfileColumns: string[],
  dynamicColumns: string[],
  title: string,
  subtitle: string
) {
  const hasUnitColumn = rows.some((r) => r.usage_unit_visible !== false);
  const entityProfileHead = entityProfileColumns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const dynamicHead = dynamicColumns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const tableRows = rows
    .map((r) => {
      const profileByName = new Map(r.entity_profile_values.map((fv) => [fv.name, fv.value]));
      const profileCells = entityProfileColumns
        .map((c) => `<td>${escapeHtml(profileByName.get(c) ?? "—")}</td>`)
        .join("");
      const byName = new Map(r.field_values.map((fv) => [fv.name, fv.value]));
      const dynamicCells = dynamicColumns
        .map((c) => `<td>${escapeHtml(byName.get(c) ?? "—")}</td>`)
        .join("");
      const unitCell = hasUnitColumn
        ? `<td>${escapeHtml(r.usage_unit_visible === false ? "" : (r.usage_unit_name || "—"))}</td>`
        : "";
      return `<tr>
        <td>${escapeHtml(r.entity_name)}</td>
        ${profileCells}
        <td>${escapeHtml(formatBusinessDate(r.logged_on))}</td>
        <td>${escapeHtml(r.value_display)}</td>
        ${unitCell}
        ${dynamicCells}
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
      h1 { font-size: 20px; margin: 0 0 6px; }
      p { margin: 0 0 16px; color: #475569; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; text-align: left; }
      th { background: #f1f5f9; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    <table>
      <thead>
        <tr>
          <th>Entidad</th>
          ${entityProfileHead}
          <th>Fecha</th>
          <th>Valor</th>
          ${hasUnitColumn ? "<th>Unidad</th>" : ""}
          ${dynamicHead}
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </body>
</html>`;
}

function buildTimelinePrintHtml(
  timelineRows: Array<{
    entity_id: string;
    entity_name: string;
    usage_unit_name: string;
    usage_unit_visible: boolean;
    valuesByBucket: Record<string, string>;
  }>,
  timelineColumns: string[],
  hasUnitColumn: boolean,
  title: string,
  subtitle: string
) {
  const timeHead = timelineColumns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const tableRows = timelineRows
    .map((r) => {
      const timeCells = timelineColumns
        .map((c) => `<td>${escapeHtml(r.valuesByBucket[c] ?? "—")}</td>`)
        .join("");
      const unitCell = hasUnitColumn
        ? `<td>${escapeHtml(r.usage_unit_visible === false ? "" : (r.usage_unit_name || "—"))}</td>`
        : "";
      return `<tr>
        <td>${escapeHtml(r.entity_name)}</td>
        ${unitCell}
        ${timeCells}
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
      h1 { font-size: 20px; margin: 0 0 6px; }
      p { margin: 0 0 16px; color: #475569; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; text-align: left; }
      th { background: #f1f5f9; white-space: nowrap; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    <table>
      <thead>
        <tr>
          <th>Entidad</th>
          ${hasUnitColumn ? "<th>Unidad</th>" : ""}
          ${timeHead}
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  </body>
</html>`;
}

function toTimeBucket(loggedOn: string) {
  const raw = String(loggedOn ?? "").trim();
  return raw || "";
}

function parseIsoDate(dateText: string) {
  const clean = String(dateText ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const [y, m, d] = clean.split("-").map((n) => Number(n));
  if (![y, m, d].every((n) => Number.isFinite(n))) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toIsoDateUtc(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function getWeekRangeFromDate(dateValue: string) {
  const base = parseIsoDate(dateValue);
  if (!base) return null;
  const day = base.getUTCDay() || 7;
  const from = new Date(base);
  from.setUTCDate(base.getUTCDate() - day + 1);
  const to = new Date(from);
  to.setUTCDate(from.getUTCDate() + 6);
  return { from: toIsoDateUtc(from), to: toIsoDateUtc(to) };
}

function getMonthRangeFromDate(dateValue: string) {
  const base = parseIsoDate(dateValue);
  if (!base) return null;
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export default function UsageReportsPage() {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [typeOptions, setTypeOptions] = useState<TypeOption[]>([]);
  const [orderedEntityProfileColumns, setOrderedEntityProfileColumns] = useState<string[]>([]);
  const [orderedUsageFieldColumns, setOrderedUsageFieldColumns] = useState<string[]>([]);

  const [periodMode, setPeriodMode] = useState<"daily" | "weekly" | "monthly">("daily");
  const [dailyDate, setDailyDate] = useState("");
  const [weeklyReferenceDate, setWeeklyReferenceDate] = useState("");
  const [monthlyReferenceDate, setMonthlyReferenceDate] = useState("");
  const [entityTypeId, setEntityTypeId] = useState("all");
  const [q, setQ] = useState("");
  const [viewMode, setViewMode] = useState<"detail" | "timeline">("detail");

  function getPeriodRange() {
    if (periodMode === "daily") {
      const day = String(dailyDate ?? "").trim();
      if (!day) return null;
      return { from: day, to: day };
    }
    if (periodMode === "weekly") return getWeekRangeFromDate(weeklyReferenceDate);
    return getMonthRangeFromDate(monthlyReferenceDate);
  }

  function hasValidServerFilters() {
    return Boolean(getPeriodRange());
  }
  const selectedPeriodRange = getPeriodRange();

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return null;
    }
    return token;
  }

  async function loadTypeOptions() {
    setErrorMsg("");
    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/entity-types", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setTypeOptions([]);
      return;
    }
    setTypeOptions((json.entity_types ?? []) as TypeOption[]);
  }

  async function load() {
    if (!hasValidServerFilters()) {
      setRows([]);
      setHasSearched(false);
      setErrorMsg("");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

    const qs = new URLSearchParams();
    const periodRange = getPeriodRange();
    if (periodRange?.from) qs.set("date_from", periodRange.from);
    if (periodRange?.to) qs.set("date_to", periodRange.to);
    if (entityTypeId && entityTypeId !== "all") qs.set("entity_type_id", entityTypeId);
    qs.set("limit", "5000");

    const res = await fetch(`/api/reporting/usage-values?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar el reporte.");
      setRows([]);
      setHasSearched(false);
      setLoading(false);
      return;
    }

    setRows((json.rows ?? []) as Row[]);
    const orderedEntity = Array.isArray(json?.column_order?.entity_profile_columns)
      ? (json.column_order.entity_profile_columns as Array<{ name?: unknown }>)
          .map((c) => String(c?.name ?? "").trim())
          .filter((v) => v.length > 0)
      : [];
    const orderedUsage = Array.isArray(json?.column_order?.usage_field_columns)
      ? (json.column_order.usage_field_columns as Array<{ name?: unknown }>)
          .map((c) => String(c?.name ?? "").trim())
          .filter((v) => v.length > 0)
      : [];
    setOrderedEntityProfileColumns(orderedEntity);
    setOrderedUsageFieldColumns(orderedUsage);
    setHasSearched(true);
    setLoading(false);
  }

  useEffect(() => {
    void loadTypeOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const today = todayInput();
    setDailyDate((prev) => prev || today);
    setWeeklyReferenceDate((prev) => prev || today);
    setMonthlyReferenceDate((prev) => prev || today);
  }, []);

  useEffect(() => {
    if (!hasValidServerFilters()) {
      setHasSearched(false);
      setRows([]);
      setErrorMsg("");
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodMode, dailyDate, weeklyReferenceDate, monthlyReferenceDate, entityTypeId]);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const fields = r.field_values.map((f) => `${f.name} ${f.value}`).join(" ").toLowerCase();
      const profile = r.entity_profile_values.map((f) => `${f.name} ${f.value}`).join(" ").toLowerCase();
      return (
        r.entity_name.toLowerCase().includes(needle) ||
        r.entity_type_name.toLowerCase().includes(needle) ||
        r.value_display.toLowerCase().includes(needle) ||
        fields.includes(needle) ||
        profile.includes(needle)
      );
    });
  }, [q, rows]);

  const entityProfileColumns = useMemo(() => {
    const set = new Set<string>(orderedEntityProfileColumns);
    for (const r of filteredRows) {
      for (const fv of r.entity_profile_values) {
        const name = String(fv.name ?? "").trim();
        if (name) set.add(name);
      }
    }
    const values = Array.from(set);
    return values.sort((a, b) => {
      const ai = orderedEntityProfileColumns.indexOf(a);
      const bi = orderedEntityProfileColumns.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b, "es", { sensitivity: "base" });
    });
  }, [filteredRows, orderedEntityProfileColumns]);

  const dynamicColumns = useMemo(() => {
    const set = new Set<string>(orderedUsageFieldColumns);
    for (const r of filteredRows) {
      for (const fv of r.field_values) {
        const name = String(fv.name ?? "").trim();
        if (name) set.add(name);
      }
    }
    const values = Array.from(set);
    return values.sort((a, b) => {
      const ai = orderedUsageFieldColumns.indexOf(a);
      const bi = orderedUsageFieldColumns.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b, "es", { sensitivity: "base" });
    });
  }, [filteredRows, orderedUsageFieldColumns]);
  const hasUnitColumn = useMemo(
    () => filteredRows.some((r) => r.usage_unit_visible !== false),
    [filteredRows]
  );
  const timelineColumns = useMemo(() => {
    const values = Array.from(
      new Set(
        filteredRows
          .map((r) => toTimeBucket(r.logged_on))
          .filter((v) => v.length > 0)
      )
    );
    return values.sort((a, b) => a.localeCompare(b));
  }, [filteredRows]);
  const timelineRows = useMemo(() => {
    const byEntity = new Map<
      string,
      {
        entity_id: string;
        entity_name: string;
        usage_unit_name: string;
        usage_unit_visible: boolean;
        valuesByBucket: Record<string, { valueDisplay: string; loggedAt: string }>;
      }
    >();
    for (const row of filteredRows) {
      const bucket = toTimeBucket(row.logged_on);
      if (!bucket) continue;
      const current = byEntity.get(row.entity_id) ?? {
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        usage_unit_name: row.usage_unit_name,
        usage_unit_visible: row.usage_unit_visible !== false,
        valuesByBucket: {},
      };
      const prev = current.valuesByBucket[bucket];
      const prevTime = prev?.loggedAt ? Date.parse(prev.loggedAt) : Number.NEGATIVE_INFINITY;
      const nextTime = row.logged_at ? Date.parse(row.logged_at) : Number.NEGATIVE_INFINITY;
      if (!prev || nextTime >= prevTime) {
        current.valuesByBucket[bucket] = { valueDisplay: row.value_display, loggedAt: row.logged_at };
      }
      byEntity.set(row.entity_id, current);
    }
    return Array.from(byEntity.values())
      .sort((a, b) => a.entity_name.localeCompare(b.entity_name, "es", { sensitivity: "base" }))
      .map((item) => ({
        entity_id: item.entity_id,
        entity_name: item.entity_name,
        usage_unit_name: item.usage_unit_name,
        usage_unit_visible: item.usage_unit_visible,
        valuesByBucket: Object.fromEntries(
          Object.entries(item.valuesByBucket).map(([bucket, payload]) => [bucket, payload.valueDisplay])
        ),
      }));
  }, [filteredRows]);
  const hasUnitColumnTimeline = useMemo(
    () => timelineRows.some((r) => r.usage_unit_visible !== false),
    [timelineRows]
  );

  async function exportExcel() {
    setBusy(true);
    try {
      const csvRows: string[][] = [];
      if (viewMode === "detail") {
        csvRows.push([
          "Entidad",
          ...entityProfileColumns,
          "Fecha",
          "Valor",
          ...(hasUnitColumn ? ["Unidad"] : []),
          ...dynamicColumns,
        ]);
        for (const r of filteredRows) {
          csvRows.push([
            r.entity_name,
            ...entityProfileColumns.map((col) => {
              const found = r.entity_profile_values.find((fv) => fv.name === col);
              return found?.value ?? "";
            }),
            formatBusinessDate(r.logged_on),
            r.value_display,
            ...(hasUnitColumn ? [r.usage_unit_visible === false ? "" : (r.usage_unit_name || "")] : []),
            ...dynamicColumns.map((col) => {
              const found = r.field_values.find((fv) => fv.name === col);
              return found?.value ?? "";
            }),
          ]);
        }
      } else {
        csvRows.push([
          "Entidad",
          ...(hasUnitColumnTimeline ? ["Unidad"] : []),
          ...timelineColumns,
        ]);
        for (const r of timelineRows) {
          csvRows.push([
            r.entity_name,
            ...(hasUnitColumnTimeline ? [r.usage_unit_visible === false ? "" : (r.usage_unit_name || "")] : []),
            ...timelineColumns.map((bucket) => r.valuesByBucket[bucket] ?? ""),
          ]);
        }
      }
      const csv = toCsv(csvRows);
      const xml = csvToSpreadsheetXml(csv, viewMode === "detail" ? "ReporteUsoDetalle" : "ReporteUsoHorizontal");
      const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = viewMode === "detail" ? "reporte_uso_detalle.xls" : "reporte_uso_horizontal.xls";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    setBusy(true);
    try {
      const periodRange = getPeriodRange();
      const dateLabel = periodRange ? `${periodRange.from} a ${periodRange.to}` : "—";
      const periodLabel = periodMode === "daily" ? "Diario" : periodMode === "weekly" ? "Semanal" : "Mensual";
      const subtitle = `Filtro: ${entityTypeId === "all" ? "Todos los tipos" : "Tipo específico"} · Fecha: ${
        dateLabel
      } · ${
        viewMode === "detail"
          ? `Registros: ${filteredRows.length}`
          : `Entidades: ${timelineRows.length} · Periodicidad: ${periodLabel}`
      }`;
      const html =
        viewMode === "detail"
          ? buildPrintHtml(filteredRows, entityProfileColumns, dynamicColumns, "Reporte de Valores de Uso", subtitle)
          : buildTimelinePrintHtml(
              timelineRows,
              timelineColumns,
              hasUnitColumnTimeline,
              "Reporte de Valores de Uso (Horizontal)",
              subtitle
            );
      const win = window.open("", "_blank");
      if (!win) {
        setErrorMsg("No se pudo abrir la ventana de impresión. Revisa el bloqueo de popups.");
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
      win.print();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="app-page-title">Reportes de Uso</CardTitle>
              <p className="app-page-subtitle">Consulta histórica de registros de uso con filtros y exportación.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app/usage-capture">
                <Button variant="outline" size="sm">Captura uso</Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy}>
                Refrescar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <div className="app-alert app-alert-error whitespace-pre-wrap">{errorMsg}</div> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 md:grid-cols-[220px_170px_180px_240px_minmax(220px,1fr)]">
            <select
              value={entityTypeId}
              onChange={(e) => setEntityTypeId(e.target.value)}
              className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
            >
              <option value="all">Todos los tipos</option>
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as "detail" | "timeline")}
              className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
            >
              <option value="detail">Vista vertical</option>
              <option value="timeline">Vista horizontal</option>
            </select>
            <select
              value={periodMode}
              onChange={(e) => setPeriodMode(e.target.value as "daily" | "weekly" | "monthly")}
              className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
            >
              <option value="daily">Diario</option>
              <option value="weekly">Semanal</option>
              <option value="monthly">Mensual</option>
            </select>
            <div className="grid gap-1">
              <MarkedDatePicker
                value={periodMode === "daily" ? dailyDate : periodMode === "weekly" ? weeklyReferenceDate : monthlyReferenceDate}
                onChange={(value) => {
                  if (periodMode === "daily") setDailyDate(value);
                  else if (periodMode === "weekly") setWeeklyReferenceDate(value);
                  else setMonthlyReferenceDate(value);
                }}
                highlightedDates={[]}
                disabledDates={[]}
                label={
                  periodMode === "daily"
                    ? "Fecha"
                    : periodMode === "weekly"
                      ? "Fecha de referencia (semana)"
                      : "Fecha de referencia (mes)"
                }
                disabled={loading || busy}
                showLegend={false}
              />
              {periodMode === "weekly" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || busy}
                  onClick={() => setWeeklyReferenceDate(todayInput())}
                >
                  Semana actual
                </Button>
              ) : null}
              {periodMode === "monthly" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={loading || busy}
                  onClick={() => setMonthlyReferenceDate(todayInput())}
                >
                  Mes actual
                </Button>
              ) : null}
            </div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por entidad, valor o campo..." />
          </div>
          {periodMode !== "daily" && selectedPeriodRange ? (
            <div className="mt-1 text-xs text-[var(--muted-foreground)]">
              Rango aplicado: {selectedPeriodRange.from} a {selectedPeriodRange.to}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportExcel()} disabled={loading || busy || filteredRows.length === 0}>
              Exportar Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={loading || busy || filteredRows.length === 0}>
              Exportar PDF
            </Button>
            <span className="text-xs text-[var(--muted-foreground)]">
              {viewMode === "detail"
                ? `Registros: ${filteredRows.length}`
                : `Entidades: ${timelineRows.length} · Columnas tiempo: ${timelineColumns.length}`}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Resultados</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex min-h-[60vh] items-center justify-center py-6">
              <Loader label="Cargando reporte..." />
            </div>
          ) : !hasSearched ? (
            <p className="app-empty">Selecciona un filtro diario, semanal o mensual para cargar resultados automáticamente.</p>
          ) : filteredRows.length === 0 ? (
            <p className="app-empty">No hay registros para los filtros seleccionados.</p>
          ) : viewMode === "detail" ? (
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[color:var(--border)]">
              <table className="min-w-[980px] w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-[var(--muted)] text-[11px] text-[var(--muted-foreground)]">
                    <th className="px-3 py-2 text-left font-medium">Entidad</th>
                    <th className="px-3 py-2 text-left font-medium">Fecha</th>
                    <th className="px-3 py-2 text-left font-medium">Valor</th>
                    {hasUnitColumn ? (
                      <th className="px-3 py-2 text-left font-medium">Unidad</th>
                    ) : null}
                    {dynamicColumns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left font-medium">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((r) => {
                    const byName = new Map(r.field_values.map((fv) => [fv.name, fv.value]));
                    return (
                      <tr key={r.id} className="border-b">
                        <td className="px-3 py-2 font-medium text-[var(--foreground)]">{r.entity_name}</td>
                        <td className="px-3 py-2 text-[var(--muted-foreground)]">{formatBusinessDate(r.logged_on)}</td>
                        <td className="px-3 py-2 text-[var(--foreground)]">{r.value_display}</td>
                        {hasUnitColumn ? (
                          <td className="px-3 py-2 text-[var(--muted-foreground)]">
                            {r.usage_unit_visible === false ? "" : (r.usage_unit_name || "—")}
                          </td>
                        ) : null}
                        {dynamicColumns.map((col) => (
                          <td key={`${r.id}-${col}`} className="px-3 py-2 text-[var(--muted-foreground)]">
                            {byName.get(col) ?? "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : timelineRows.length === 0 || timelineColumns.length === 0 ? (
            <p className="app-empty">No hay datos para mostrar en vista horizontal con los filtros actuales.</p>
          ) : (
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[color:var(--border)]">
              <table className="w-full min-w-[980px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-[var(--muted)] text-[11px] text-[var(--muted-foreground)]">
                    <th className="px-3 py-2 text-left font-medium">Entidad</th>
                    {hasUnitColumnTimeline ? (
                      <th className="px-3 py-2 text-left font-medium">Unidad</th>
                    ) : null}
                    {timelineColumns.map((bucket) => (
                      <th key={`bucket-${bucket}`} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                        {bucket}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {timelineRows.map((row) => (
                    <tr key={`timeline-${row.entity_id}`} className="border-b">
                      <td className="px-3 py-2 font-medium text-[var(--foreground)]">{row.entity_name}</td>
                      {hasUnitColumnTimeline ? (
                        <td className="px-3 py-2 text-[var(--muted-foreground)]">
                          {row.usage_unit_visible === false ? "" : (row.usage_unit_name || "—")}
                        </td>
                      ) : null}
                      {timelineColumns.map((bucket) => (
                        <td key={`${row.entity_id}-${bucket}`} className="px-3 py-2 text-[var(--muted-foreground)] whitespace-nowrap">
                          {row.valuesByBucket[bucket] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
