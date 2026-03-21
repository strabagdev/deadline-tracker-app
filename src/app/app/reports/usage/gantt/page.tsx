"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHero } from "@/components/PageHero";
import { MarkedDatePicker } from "@/components/marked-date-picker";
import { cn } from "@/lib/utils";

type Scale = "week" | "month";
type RangeMode = "preset" | "custom";

type Option = {
  id: string;
  name: string;
};

type EntityInfo = {
  id: string;
  name: string;
  entity_type_name: string;
  usage_unit_name: string;
  usage_unit_visible: boolean;
};

type UsageRow = {
  id: string;
  entity_id: string;
  entity_name: string;
  entity_type_id: string | null;
  entity_type_name: string;
  usage_unit_id: string | null;
  usage_unit_name: string;
  usage_unit_visible: boolean;
  logged_on: string;
  logged_at: string;
  value: number | null;
  value_text: string | null;
  value_display: string;
  field_values: Array<{ usage_field_id: string; name: string; value: string }>;
};

type UsageCellDetail = {
  value: string;
  loggedOn: string;
  loggedAt: string;
  usageUnitName: string;
  usageUnitVisible: boolean;
  fieldValues: Array<{ usage_field_id: string; name: string; value: string }>;
};

type TimelineRow = {
  entity_id: string;
  entity_name: string;
  entity_type_name: string;
  usage_unit_name: string;
  usage_unit_visible: boolean;
  detailsByDay: Record<string, UsageCellDetail>;
  totalLoggedDays: number;
  latestLoggedOn: string | null;
  latestValue: string | null;
};

type HeatmapWeek = {
  key: string;
  label: string;
  secondaryLabel?: string;
  days: Array<{ key: string; inRange: boolean; inFocus: boolean }>;
};

function today() {
  return new Date();
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfWeek(date: Date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  return addDays(date, mondayOffset);
}

function endOfWeek(date: Date) {
  return addDays(startOfWeek(date), 6);
}

function shiftAnchor(anchor: Date, scale: Scale, delta: number) {
  if (scale === "week") return addDays(anchor, delta * 7);
  if (scale === "month") return addMonths(anchor, delta);
  return anchor;
}

function getRange(anchor: Date, scale: Scale) {
  if (scale === "week") return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  if (scale === "month") return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  return { from: anchor, to: anchor };
}

function getPresetPeriodLabel(anchor: Date, scale: Scale) {
  if (scale === "week") {
    const from = startOfWeek(anchor);
    const to = endOfWeek(anchor);
    return `${from.toLocaleDateString("es-CL", { day: "2-digit", month: "short" })} - ${to.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })}`;
  }
  if (scale === "month") return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return "";
}

function getColumns(from: Date, to: Date, focusFrom?: Date, focusTo?: Date) {
  const focusFromIso = focusFrom ? toIsoDate(focusFrom) : null;
  const focusToIso = focusTo ? toIsoDate(focusTo) : null;
  const count = countDaysInclusive(from, to);
  return Array.from({ length: count }, (_, idx) => {
    const date = addDays(from, idx);
    const iso = toIsoDate(date);
    return {
      key: iso,
      label: String(date.getDate()),
      secondary: date.toLocaleDateString("es", { weekday: "short" }).slice(0, 2),
      inFocus: !focusFromIso || !focusToIso || (iso >= focusFromIso && iso <= focusToIso),
    };
  });
}

function countDaysInclusive(from: Date, to: Date) {
  const diff = to.getTime() - from.getTime();
  return Math.floor(diff / 86_400_000) + 1;
}

function parseIsoDate(dateText: string) {
  const clean = String(dateText ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return null;
  const [year, month, day] = clean.split("-").map((part) => Number(part));
  if (![year, month, day].every((part) => Number.isFinite(part))) return null;
  return new Date(year, month - 1, day);
}

function buildHeatmapWeeks(from: Date, to: Date, scale: Scale, focusFrom?: Date, focusTo?: Date) {
  const start = scale === "month" ? from : startOfWeek(from);
  const focusFromIso = focusFrom ? toIsoDate(focusFrom) : null;
  const focusToIso = focusTo ? toIsoDate(focusTo) : null;
  const totalWeeks = Math.ceil(countDaysInclusive(start, to) / 7);
  const weeks: HeatmapWeek[] = [];

  for (let weekIndex = 0; weekIndex < totalWeeks; weekIndex += 1) {
    const weekStart = addDays(start, weekIndex * 7);
    const endOfBlock = addDays(weekStart, 6);
    const blockMonth = formatMonthTag(weekStart);
    weeks.push({
      key: toIsoDate(weekStart),
      label:
        scale === "month"
          ? `${blockMonth} · B${weekIndex + 1}`
          : weekStart.toLocaleDateString("es", { month: "short" }).replace(".", ""),
      secondaryLabel:
        scale === "month"
          ? `${weekStart.getDate()}-${Math.min(endOfBlock.getDate(), to.getDate())}`
          : undefined,
      days: Array.from({ length: 7 }, (_, dayIndex) => {
        const date = addDays(weekStart, dayIndex);
        const iso = toIsoDate(date);
        return {
          key: iso,
          inRange: iso >= toIsoDate(from) && iso <= toIsoDate(to),
          inFocus: !focusFromIso || !focusToIso || (iso >= focusFromIso && iso <= focusToIso),
        };
      }),
    });
  }

  return weeks;
}

function isNumericLike(value: string) {
  return /^-?\d+([.,]\d+)?$/.test(String(value).trim());
}

function heatmapTone(value: string | null, inRange: boolean) {
  if (!inRange) return "border-transparent bg-transparent";
  if (!value) return "border-slate-200 bg-slate-100/80";
  if (isNumericLike(value)) return "border-sky-200 bg-sky-500/80";
  return "border-emerald-200 bg-emerald-500/80";
}

function contextTone(inFocus: boolean) {
  return inFocus ? "" : "opacity-35";
}

function formatDateLabel(dateText: string) {
  const date = parseIsoDate(dateText);
  if (!date) return dateText;
  return date.toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
}

function formatMonthTag(date: Date) {
  return date.toLocaleDateString("es-CL", { month: "short" }).replace(".", "");
}

function getCustomPeriodLabel(fromText: string, toText: string) {
  const from = parseIsoDate(fromText);
  const to = parseIsoDate(toText);
  if (!from || !to || fromText > toText) return "Rango personalizado";
  return `${formatDateLabel(fromText)} - ${formatDateLabel(toText)}`;
}

function filterSelectClass() {
  return "h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] text-slate-700 sm:text-sm";
}

function getGridMetrics(columnCount: number) {
  if (columnCount >= 120) return { dayCellSize: 10, dayCellGap: 2, blockGap: 2, leftColWidth: 180 };
  if (columnCount >= 90) return { dayCellSize: 11, dayCellGap: 2, blockGap: 2, leftColWidth: 190 };
  if (columnCount >= 60) return { dayCellSize: 12, dayCellGap: 3, blockGap: 3, leftColWidth: 200 };
  if (columnCount >= 40) return { dayCellSize: 13, dayCellGap: 3, blockGap: 3, leftColWidth: 210 };
  if (columnCount >= 21) return { dayCellSize: 14, dayCellGap: 3, blockGap: 3, leftColWidth: 220 };
  return { dayCellSize: 16, dayCellGap: 4, blockGap: 4, leftColWidth: 220 };
}

export default function UsageGanttPage() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [entityRows, setEntityRows] = useState<EntityInfo[]>([]);
  const [entityOptions, setEntityOptions] = useState<Option[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<Option[]>([]);
  const [usageUnitOptions, setUsageUnitOptions] = useState<Option[]>([]);
  const [entityId, setEntityId] = useState("all");
  const [entityTypeId, setEntityTypeId] = useState("all");
  const [usageUnitId, setUsageUnitId] = useState("all");
  const [rangeMode, setRangeMode] = useState<RangeMode>("preset");
  const [scale, setScale] = useState<Scale>("month");
  const [anchor, setAnchor] = useState(today);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const presetRange = useMemo(() => getRange(anchor, scale), [anchor, scale]);
  const presetFocusRange = useMemo(() => getRange(anchor, scale), [anchor, scale]);

  useEffect(() => {
    if (rangeMode !== "preset") return;
    setDateFrom(toIsoDate(presetRange.from));
    setDateTo(toIsoDate(presetRange.to));
  }, [presetRange.from, presetRange.to, rangeMode]);

  const effectiveRange = useMemo(() => {
    const from = parseIsoDate(dateFrom);
    const to = parseIsoDate(dateTo);
    if (!from || !to || dateFrom > dateTo) return presetRange;
    return { from, to };
  }, [dateFrom, dateTo, presetRange]);

  const displayRange = useMemo(() => {
    return effectiveRange;
  }, [effectiveRange]);

  const columns = useMemo(
    () => getColumns(displayRange.from, displayRange.to, rangeMode === "preset" && scale === "month" ? presetFocusRange.from : undefined, rangeMode === "preset" && scale === "month" ? presetFocusRange.to : undefined),
    [displayRange.from, displayRange.to, presetFocusRange.from, presetFocusRange.to, rangeMode, scale]
  );
  const heatmapWeeks = useMemo(
    () => buildHeatmapWeeks(displayRange.from, displayRange.to, scale, rangeMode === "preset" && scale === "month" ? presetFocusRange.from : undefined, rangeMode === "preset" && scale === "month" ? presetFocusRange.to : undefined),
    [displayRange.from, displayRange.to, presetFocusRange.from, presetFocusRange.to, rangeMode, scale]
  );
  const gridMetrics = useMemo(() => getGridMetrics(columns.length), [columns.length]);
  const weekBlockWidth = gridMetrics.dayCellSize * 7 + gridMetrics.dayCellGap * 6;
  const periodLabel = useMemo(
    () => (rangeMode === "custom" ? getCustomPeriodLabel(dateFrom, dateTo) : getPresetPeriodLabel(anchor, scale)),
    [anchor, dateFrom, dateTo, rangeMode, scale]
  );
  const highlightedDates = useMemo(
    () => Array.from(new Set(rows.map((row) => row.logged_on).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))).sort(),
    [rows]
  );

  async function load() {
    setLoading(true);
    setErrorMsg("");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return;
    }

    const qs = new URLSearchParams();
    qs.set("date_from", toIsoDate(displayRange.from));
    qs.set("date_to", toIsoDate(displayRange.to));
    if (entityId !== "all") qs.set("entity_id", entityId);
    if (entityTypeId !== "all") qs.set("entity_type_id", entityTypeId);
    if (usageUnitId !== "all") qs.set("usage_unit_id", usageUnitId);

    const res = await fetch(`/api/reporting/usage-gantt?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar la carta Gantt de uso.");
      setRows([]);
      setEntityRows([]);
      setLoading(false);
      return;
    }

    setRows(Array.isArray(json.rows) ? json.rows : []);
    setEntityRows(Array.isArray(json.entity_rows) ? json.entity_rows : []);
    setEntityOptions(Array.isArray(json.options?.entities) ? json.options.entities : []);
    setEntityTypeOptions(Array.isArray(json.options?.entity_types) ? json.options.entity_types : []);
    setUsageUnitOptions(Array.isArray(json.options?.usage_units) ? json.options.usage_units : []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, entityTypeId, usageUnitId, scale, anchor, dateFrom, dateTo, displayRange.from, displayRange.to]);

  const timelineRows = useMemo<TimelineRow[]>(() => {
    const byEntity = new Map<string, TimelineRow & { metaByDay: Record<string, { loggedAt: string }> }>();

    for (const entity of entityRows) {
      byEntity.set(entity.id, {
        entity_id: entity.id,
        entity_name: entity.name,
        entity_type_name: entity.entity_type_name,
        usage_unit_name: entity.usage_unit_name,
        usage_unit_visible: entity.usage_unit_visible !== false,
        detailsByDay: {},
        metaByDay: {},
        totalLoggedDays: 0,
        latestLoggedOn: null,
        latestValue: null,
      });
    }

    for (const row of rows) {
      const current = byEntity.get(row.entity_id) ?? {
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        entity_type_name: row.entity_type_name,
        usage_unit_name: row.usage_unit_name,
        usage_unit_visible: row.usage_unit_visible !== false,
        detailsByDay: {},
        metaByDay: {},
        totalLoggedDays: 0,
        latestLoggedOn: null,
        latestValue: null,
      };
      const previousLoggedAt = current.metaByDay[row.logged_on]?.loggedAt ? Date.parse(current.metaByDay[row.logged_on].loggedAt) : Number.NEGATIVE_INFINITY;
      const nextLoggedAt = row.logged_at ? Date.parse(row.logged_at) : Number.NEGATIVE_INFINITY;
      if (!current.detailsByDay[row.logged_on] || nextLoggedAt >= previousLoggedAt) {
        current.detailsByDay[row.logged_on] = {
          value: row.value_display,
          loggedOn: row.logged_on,
          loggedAt: row.logged_at,
          usageUnitName: row.usage_unit_name,
          usageUnitVisible: row.usage_unit_visible !== false,
          fieldValues: Array.isArray(row.field_values) ? row.field_values : [],
        };
        current.metaByDay[row.logged_on] = { loggedAt: row.logged_at };
        if (!current.latestLoggedOn || row.logged_on >= current.latestLoggedOn) {
          current.latestLoggedOn = row.logged_on;
          current.latestValue = row.value_display;
        }
      }
      byEntity.set(row.entity_id, current);
    }

    return Array.from(byEntity.values())
      .sort((a, b) => a.entity_name.localeCompare(b.entity_name, "es", { sensitivity: "base" }))
      .map((item) => ({
        entity_id: item.entity_id,
        entity_name: item.entity_name,
        entity_type_name: item.entity_type_name,
        usage_unit_name: item.usage_unit_name,
        usage_unit_visible: item.usage_unit_visible,
        detailsByDay: item.detailsByDay,
        totalLoggedDays: Object.keys(item.detailsByDay).length,
        latestLoggedOn: item.latestLoggedOn,
        latestValue: item.latestValue,
      }));
  }, [entityRows, rows]);

  return (
    <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-4 sm:space-y-6">
      <PageHero
        badge="Reportes"
        secondaryBadge="Uso"
        title="Carta Gantt de registro de uso"
        subtitle="Vista compacta por entidad para seguir el registro de uso en el tiempo, sin depender de una tabla ancha."
        actions={
          <Link href="/app/reports/usage">
            <Button variant="outline" size="sm">Volver a Reportes</Button>
          </Link>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <CardTitle className="text-base">Filtros</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">Alcance y periodo del trazado.</p>
            </div>
            <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-medium text-slate-500">
              {periodLabel}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 pt-0 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.9fr)]">
          <section className="rounded-[16px] border border-slate-200 bg-slate-50/70 p-2.5">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Alcance</div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-0.5">
                <span className="text-[11px] text-slate-500">Entidad</span>
                <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className={filterSelectClass()}>
                  <option value="all">Todas las entidades</option>
                  {entityOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-0.5">
                <span className="text-[11px] text-slate-500">Tipo</span>
                <select value={entityTypeId} onChange={(e) => setEntityTypeId(e.target.value)} className={filterSelectClass()}>
                  <option value="all">Todos los tipos</option>
                  {entityTypeOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-0.5">
                <span className="text-[11px] text-slate-500">Unidad</span>
                <select value={usageUnitId} onChange={(e) => setUsageUnitId(e.target.value)} className={filterSelectClass()}>
                  <option value="all">Todas las unidades</option>
                  {usageUnitOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-[16px] border border-slate-200 bg-white p-2.5 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.4)]">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Periodo</div>
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setRangeMode("preset")}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                    rangeMode === "preset" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Guiado
                </button>
                <button
                  type="button"
                  onClick={() => setRangeMode("custom")}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                    rangeMode === "custom" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Rango
                </button>
              </div>
            </div>

            {rangeMode === "preset" ? (
              <div className="space-y-2">
                <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                  {([
                    { value: "week", label: "Semanal" },
                    { value: "month", label: "Mensual" },
                  ] as Array<{ value: Scale; label: string }>).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setScale(option.value)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition",
                        scale === option.value ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => setAnchor((prev) => shiftAnchor(prev, scale, -1))}>Anterior</Button>
                  <Button variant="outline" size="sm" onClick={() => setAnchor((prev) => shiftAnchor(prev, scale, 1))}>Siguiente</Button>
                  <Button variant="outline" size="sm" onClick={() => setAnchor(today())}>Hoy</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <MarkedDatePicker
                    value={dateFrom}
                    onChange={setDateFrom}
                    highlightedDates={highlightedDates}
                    label="Desde"
                    showLegend={false}
                  />
                  <MarkedDatePicker
                    value={dateTo}
                    onChange={setDateTo}
                    highlightedDates={highlightedDates}
                    label="Hasta"
                    showLegend={false}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-[12px] border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                  <div className="min-w-0 text-xs font-semibold text-slate-700">{periodLabel}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRangeMode("preset");
                      setDateFrom(toIsoDate(presetRange.from));
                      setDateTo(toIsoDate(presetRange.to));
                    }}
                  >
                    Volver a guiado
                  </Button>
                </div>
              </div>
            )}
          </section>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader label="Construyendo Gantt de uso..." />
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
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <CardTitle className="text-base">Mapa de actividad</CardTitle>
                <p className="mt-1 text-sm text-slate-500">
                  Cada entidad ocupa una sola fila y distribuye sus registros diarios sobre todo el ancho disponible.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-[4px] border border-slate-200 bg-slate-100/80" />
                  Sin registro
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-[4px] border border-sky-200 bg-sky-500/80" />
                  Valor numérico
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-[4px] border border-emerald-200 bg-emerald-500/80" />
                  Valor texto
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {timelineRows.length === 0 ? (
              <p className="app-empty">No hay entidades para los filtros seleccionados.</p>
            ) : (
              <div className="overflow-x-auto md:overflow-visible">
                <div className="min-w-[760px] space-y-2 md:min-w-0">
                  <div className="grid items-end gap-2 rounded-xl bg-slate-50 px-3 py-2" style={{ gridTemplateColumns: `${gridMetrics.leftColWidth}px minmax(0,1fr)` }}>
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Entidad</div>
                    <div className="space-y-1">
                      {scale === "month" ? (
                        <div className="grid" style={{ gap: `${gridMetrics.blockGap}px`, gridTemplateColumns: `repeat(${heatmapWeeks.length}, ${weekBlockWidth}px)` }}>
                          {heatmapWeeks.map((week) => (
                            <div key={`header-block-${week.key}`} className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                              {week.label}
                              {week.secondaryLabel ? <span className="ml-1 normal-case tracking-normal text-slate-300">{week.secondaryLabel}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="grid" style={{ gap: `${gridMetrics.dayCellGap}px`, gridTemplateColumns: `repeat(${columns.length}, ${gridMetrics.dayCellSize}px)` }}>
                          {columns.map((column) => (
                          <div key={`header-day-${column.key}`} className={cn("text-center text-[10px] font-medium text-slate-400", contextTone(column.inFocus))}>
                            <div>{column.label}</div>
                            <div className="text-[9px] text-slate-300">{column.secondary}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {timelineRows.map((row) => (
                    <section key={row.entity_id} className="grid items-center gap-2 rounded-xl border border-slate-200 bg-white/85 px-3 py-1.5 shadow-sm" style={{ gridTemplateColumns: `${gridMetrics.leftColWidth}px minmax(0,1fr)` }}>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold leading-tight text-slate-900">{row.entity_name}</div>
                      </div>

                      <div className="space-y-1">
                        {scale === "month" ? (
                          <div className="grid" style={{ gap: `${gridMetrics.blockGap}px`, gridTemplateColumns: `repeat(${heatmapWeeks.length}, ${weekBlockWidth}px)` }}>
                            {heatmapWeeks.map((week) => (
                              <div key={`${row.entity_id}-block-${week.key}`} className="h-1 rounded-full bg-slate-100" />
                            ))}
                          </div>
                        ) : null}
                        <div className="grid" style={{ gap: `${gridMetrics.dayCellGap}px`, gridTemplateColumns: `repeat(${columns.length}, ${gridMetrics.dayCellSize}px)` }}>
                          {columns.map((column) => {
                            const detail = row.detailsByDay[column.key] ?? null;
                            const value = detail?.value ?? null;
                            return (
                              <div
                                key={`${row.entity_id}-${column.key}`}
                                className={cn(
                                  "group relative rounded-[4px] border",
                                  value ? "hover:scale-110 hover:shadow-sm" : "",
                                  heatmapTone(value, true),
                                  contextTone(column.inFocus)
                                )}
                                style={{ height: `${gridMetrics.dayCellSize}px`, width: `${gridMetrics.dayCellSize}px` }}
                              >
                                {detail ? (
                                  <div className="pointer-events-none absolute bottom-full left-1/2 z-30 hidden w-64 -translate-x-1/2 -translate-y-2 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl group-hover:block">
                                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                      {formatDateLabel(detail.loggedOn)}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-slate-900">{detail.value}</div>
                                    {detail.usageUnitVisible && detail.usageUnitName ? (
                                      <div className="mt-2 text-[11px] text-slate-600">Unidad: {detail.usageUnitName}</div>
                                    ) : null}
                                    {detail.fieldValues.length > 0 ? (
                                      <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                                        {detail.fieldValues.map((field) => (
                                          <div key={`${row.entity_id}-${column.key}-${field.usage_field_id}`} className="flex items-start justify-between gap-2 text-[11px]">
                                            <span className="text-slate-500">{field.name}</span>
                                            <span className="max-w-[132px] text-right font-medium text-slate-800">{field.value}</span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="mt-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400">Sin campos adicionales</div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
