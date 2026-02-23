"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  field_values: Array<{ usage_field_id: string; name: string; value: string }>;
};

type TypeOption = { id: string; name: string };

function todayInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function defaultFromInput() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
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

function buildPrintHtml(rows: Row[], dynamicColumns: string[], title: string, subtitle: string) {
  const hasUnitColumn = rows.some((r) => r.usage_unit_visible !== false);
  const dynamicHead = dynamicColumns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const tableRows = rows
    .map((r) => {
      const byName = new Map(r.field_values.map((fv) => [fv.name, fv.value]));
      const dynamicCells = dynamicColumns
        .map((c) => `<td>${escapeHtml(byName.get(c) ?? "—")}</td>`)
        .join("");
      const unitCell = hasUnitColumn
        ? `<td>${escapeHtml(r.usage_unit_visible === false ? "" : (r.usage_unit_name || "—"))}</td>`
        : "";
      return `<tr>
        <td>${escapeHtml(r.entity_name)}</td>
        <td>${escapeHtml(r.entity_type_name)}</td>
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
          <th>Tipo</th>
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

export default function UsageReportsPage() {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const [rows, setRows] = useState<Row[]>([]);
  const [typeOptions, setTypeOptions] = useState<TypeOption[]>([]);

  const [dateMode, setDateMode] = useState<"range" | "single">("single");
  const [dateFrom, setDateFrom] = useState(defaultFromInput());
  const [dateTo, setDateTo] = useState(todayInput());
  const [singleDate, setSingleDate] = useState("");
  const [entityTypeId, setEntityTypeId] = useState("all");
  const [q, setQ] = useState("");

  function hasValidServerFilters() {
    if (dateMode === "single") return Boolean(singleDate);
    return Boolean(dateFrom || dateTo);
  }

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
    if (!token) return;

    const qs = new URLSearchParams();
    if (dateMode === "single") {
      if (singleDate) {
        qs.set("date_from", singleDate);
        qs.set("date_to", singleDate);
      }
    } else {
      if (dateFrom) qs.set("date_from", dateFrom);
      if (dateTo) qs.set("date_to", dateTo);
    }
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
    setHasSearched(true);
    setLoading(false);
  }

  useEffect(() => {
    void loadTypeOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }, [dateMode, dateFrom, dateTo, singleDate, entityTypeId]);

  const filteredRows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const fields = r.field_values.map((f) => `${f.name} ${f.value}`).join(" ").toLowerCase();
      return (
        r.entity_name.toLowerCase().includes(needle) ||
        r.entity_type_name.toLowerCase().includes(needle) ||
        r.value_display.toLowerCase().includes(needle) ||
        fields.includes(needle)
      );
    });
  }, [q, rows]);

  const dynamicColumns = useMemo(() => {
    const set = new Set<string>();
    for (const r of filteredRows) {
      for (const fv of r.field_values) {
        const name = String(fv.name ?? "").trim();
        if (name) set.add(name);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
  }, [filteredRows]);
  const hasUnitColumn = useMemo(
    () => filteredRows.some((r) => r.usage_unit_visible !== false),
    [filteredRows]
  );

  async function exportExcel() {
    setBusy(true);
    try {
      const csvRows = [
        ["Entidad", "Tipo entidad", "Fecha", "Valor", ...(hasUnitColumn ? ["Unidad"] : []), ...dynamicColumns],
        ...filteredRows.map((r) => [
          r.entity_name,
          r.entity_type_name,
          formatBusinessDate(r.logged_on),
          r.value_display,
          ...(hasUnitColumn ? [r.usage_unit_visible === false ? "" : (r.usage_unit_name || "")] : []),
          ...dynamicColumns.map((col) => {
            const found = r.field_values.find((fv) => fv.name === col);
            return found?.value ?? "";
          }),
        ]),
      ];
      const csv = toCsv(csvRows);
      const xml = csvToSpreadsheetXml(csv, "ReporteUso");
      const blob = new Blob([xml], { type: "application/vnd.ms-excel;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "reporte_uso.xls";
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
      const subtitle = `Filtro: ${entityTypeId === "all" ? "Todos los tipos" : "Tipo específico"} · Fecha: ${
        dateMode === "single" ? (singleDate || "—") : `${dateFrom || "—"} a ${dateTo || "—"}`
      } · Registros: ${filteredRows.length}`;
      const html = buildPrintHtml(filteredRows, dynamicColumns, "Reporte de Valores de Uso", subtitle);
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
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Reportes de Uso</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Consulta histórica de registros de uso con filtros y exportación.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app/usage">
                <Button variant="outline" size="sm">Registro uso</Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy}>
                Refrescar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 md:grid-cols-[170px_170px_170px_220px_minmax(220px,1fr)]">
            <select
              value={dateMode}
              onChange={(e) => setDateMode(e.target.value as "range" | "single")}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="range">Rango de fechas</option>
              <option value="single">Fecha exacta</option>
            </select>
            {dateMode === "single" ? (
              <Input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} />
            ) : (
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            )}
            {dateMode === "single" ? (
              <div className="h-10" />
            ) : (
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            )}
            <select
              value={entityTypeId}
              onChange={(e) => setEntityTypeId(e.target.value)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">Todos los tipos</option>
              {typeOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por entidad, valor o campo..." />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void exportExcel()} disabled={loading || busy || filteredRows.length === 0}>
              Exportar Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={loading || busy || filteredRows.length === 0}>
              Exportar PDF
            </Button>
            <span className="text-xs text-slate-500">Registros: {filteredRows.length}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resultados</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader label="Cargando reporte..." />
            </div>
          ) : !hasSearched ? (
            <p className="text-sm text-slate-500">Selecciona fecha exacta o rango para cargar resultados automáticamente.</p>
          ) : filteredRows.length === 0 ? (
            <p className="text-sm text-slate-500">No hay registros para los filtros seleccionados.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="min-w-[980px] w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-[11px] text-slate-500">
                    <th className="px-3 py-2 text-left font-medium">Entidad</th>
                    <th className="px-3 py-2 text-left font-medium">Tipo</th>
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
                        <td className="px-3 py-2 font-medium text-slate-800">{r.entity_name}</td>
                        <td className="px-3 py-2 text-slate-700">{r.entity_type_name}</td>
                        <td className="px-3 py-2 text-slate-700">{formatBusinessDate(r.logged_on)}</td>
                        <td className="px-3 py-2 text-slate-800">{r.value_display}</td>
                        {hasUnitColumn ? (
                          <td className="px-3 py-2 text-slate-600">
                            {r.usage_unit_visible === false ? "" : (r.usage_unit_name || "—")}
                          </td>
                        ) : null}
                        {dynamicColumns.map((col) => (
                          <td key={`${r.id}-${col}`} className="px-3 py-2 text-slate-600">
                            {byName.get(col) ?? "—"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
