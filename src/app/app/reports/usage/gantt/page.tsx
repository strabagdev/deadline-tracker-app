"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  usage_unit_suggested_values: string[];
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
  usage_unit_suggested_values: string[];
  field_values: Array<{ usage_field_id: string; name: string; value: string }>;
};

type UsageCellDetail = {
  value: string;
  loggedOn: string;
  loggedAt: string;
  usageUnitName: string;
  usageUnitVisible: boolean;
  suggestedValues: string[];
  fieldValues: Array<{ usage_field_id: string; name: string; value: string }>;
};

type TimelineRow = {
  entity_id: string;
  entity_name: string;
  entity_type_name: string;
  usage_unit_name: string;
  usage_unit_visible: boolean;
  suggestedValues: string[];
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

function normalizeSuggestedValue(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function buildSuggestedPalette(values: string[]) {
  const base = [
    { bg: "bg-emerald-500/85", border: "border-emerald-200", dot: "bg-emerald-500", printBg: "#10b981", printBorder: "#bbf7d0" },
    { bg: "bg-rose-500/85", border: "border-rose-200", dot: "bg-rose-500", printBg: "#f43f5e", printBorder: "#fecdd3" },
    { bg: "bg-amber-500/85", border: "border-amber-200", dot: "bg-amber-500", printBg: "#f59e0b", printBorder: "#fde68a" },
    { bg: "bg-sky-500/85", border: "border-sky-200", dot: "bg-sky-500", printBg: "#0ea5e9", printBorder: "#bae6fd" },
    { bg: "bg-violet-500/85", border: "border-violet-200", dot: "bg-violet-500", printBg: "#8b5cf6", printBorder: "#ddd6fe" },
    { bg: "bg-orange-500/85", border: "border-orange-200", dot: "bg-orange-500", printBg: "#f97316", printBorder: "#fed7aa" },
    { bg: "bg-teal-500/85", border: "border-teal-200", dot: "bg-teal-500", printBg: "#14b8a6", printBorder: "#99f6e4" },
    { bg: "bg-indigo-500/85", border: "border-indigo-200", dot: "bg-indigo-500", printBg: "#6366f1", printBorder: "#c7d2fe" },
    { bg: "bg-fuchsia-500/85", border: "border-fuchsia-200", dot: "bg-fuchsia-500", printBg: "#d946ef", printBorder: "#f5d0fe" },
    { bg: "bg-lime-500/85", border: "border-lime-200", dot: "bg-lime-500", printBg: "#84cc16", printBorder: "#d9f99d" },
  ];
  const map = new Map<string, { bg: string; border: string; dot: string; label: string; printBg: string; printBorder: string }>();
  values.forEach((value, index) => {
    const normalized = normalizeSuggestedValue(value);
    if (!normalized || map.has(normalized)) return;
    const color = base[index % base.length];
    map.set(normalized, { ...color, label: value });
  });
  return map;
}

function heatmapTone(value: string | null, inRange: boolean, suggestedColor?: { bg: string; border: string } | null) {
  if (!inRange) return "border-transparent bg-transparent";
  if (suggestedColor && value) return `${suggestedColor.border} ${suggestedColor.bg}`;
  if (!value) return "border-slate-200 bg-slate-100/80";
  if (isNumericLike(value)) return "border-blue-200 bg-blue-600/80";
  return "border-zinc-300 bg-zinc-700/75";
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
  return "h-9 w-full rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] text-slate-700 sm:text-sm";
}

function DirectionIcon({
  direction,
  className = "h-4 w-4",
}: {
  direction: "left" | "right";
  className?: string;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {direction === "left" ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
    </svg>
  );
}

function escapeHtml(value: string) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugifyLabel(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getOptionLabel(options: Option[], selectedId: string, allLabel: string) {
  if (selectedId === "all") return allLabel;
  return options.find((option) => option.id === selectedId)?.name ?? allLabel;
}

function buildGanttPrintHtml(params: {
  title: string;
  subtitle: string;
  metadata: string[];
  columns: Array<{ key: string; label: string; secondary: string; inFocus: boolean }>;
  rows: TimelineRow[];
  suggestedColorMap: Map<string, { bg: string; border: string; dot: string; label: string; printBg: string; printBorder: string }>;
  suggestedLegend: string[];
}) {
  const { title, subtitle, metadata, columns, rows, suggestedColorMap, suggestedLegend } = params;

  const legendItems = [
    ...suggestedLegend.map((value) => {
      const color = suggestedColorMap.get(normalizeSuggestedValue(value));
      if (!color) return "";
      return `<span class="legend-item"><span class="legend-dot" style="background:${color.printBg}; border-color:${color.printBorder};"></span>${escapeHtml(value)}</span>`;
    }),
    `<span class="legend-item"><span class="legend-dot" style="background:#2563eb; border-color:#bfdbfe;"></span>Numérico</span>`,
    `<span class="legend-item"><span class="legend-dot" style="background:#3f3f46; border-color:#d4d4d8;"></span>Estado</span>`,
    `<span class="legend-item"><span class="legend-dot" style="background:#e2e8f0; border-color:#cbd5e1;"></span>Sin registro</span>`,
  ]
    .filter(Boolean)
    .join("");

  const headerDays = columns
    .map(
      (column) =>
        `<th class="${column.inFocus ? "" : "muted"}"><div>${escapeHtml(column.label)}</div><div class="day-sub">${escapeHtml(column.secondary)}</div></th>`
    )
    .join("");

  const bodyRows = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const detail = row.detailsByDay[column.key] ?? null;
          const value = detail?.value ?? null;
          const suggestedColor = value ? suggestedColorMap.get(normalizeSuggestedValue(value)) ?? null : null;
          const printBg = !value
            ? "#e2e8f0"
            : suggestedColor
              ? suggestedColor.printBg
              : isNumericLike(value)
                ? "#2563eb"
                : "#3f3f46";
          const printBorder = !value
            ? "#cbd5e1"
            : suggestedColor
              ? suggestedColor.printBorder
              : isNumericLike(value)
                ? "#bfdbfe"
                : "#d4d4d8";
          const cellTitle = detail
            ? `${detail.loggedOn} · ${detail.value}${detail.usageUnitVisible && detail.usageUnitName ? ` · ${detail.usageUnitName}` : ""}`
            : "Sin registro";
          return `<td class="${column.inFocus ? "" : "muted"}"><span class="cell" title="${escapeHtml(cellTitle)}" style="background:${printBg}; border-color:${printBorder};"></span></td>`;
        })
        .join("");

      return `<tr>
        <th class="entity-cell">${escapeHtml(row.entity_name)}</th>
        ${cells}
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; background: #f8fafc; }
      .sheet { border: 1px solid #cbd5e1; border-radius: 18px; background: #ffffff; padding: 18px 20px 16px; }
      h1 { margin: 0; font-size: 20px; }
      .subtitle { margin: 6px 0 10px; font-size: 12px; color: #475569; }
      .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
      .meta-chip { border: 1px solid #dbeafe; background: #eff6ff; color: #1d4ed8; border-radius: 999px; padding: 4px 8px; font-size: 10px; font-weight: 700; }
      .legend { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-bottom: 12px; font-size: 11px; color: #334155; }
      .legend-item { display: inline-flex; align-items: center; gap: 6px; }
      .legend-dot { width: 10px; height: 10px; border-radius: 3px; border: 1px solid transparent; display: inline-block; }
      table { width: 100%; border-collapse: separate; border-spacing: 2px 4px; table-layout: fixed; }
      thead th { font-size: 10px; font-weight: 700; color: #475569; text-align: center; white-space: nowrap; }
      .day-sub { font-size: 9px; color: #94a3b8; font-weight: 500; }
      .entity-cell { width: 180px; min-width: 180px; max-width: 180px; text-align: left; font-size: 11px; font-weight: 700; padding-right: 8px; }
      td { text-align: center; vertical-align: middle; }
      .cell { display: inline-block; width: 10px; height: 10px; border-radius: 3px; border: 1px solid transparent; }
      .muted { opacity: 0.4; }
    </style>
    <script>
      (() => {
        let printHandled = false;
        let closeQueued = false;

        const closeWindow = () => {
          if (closeQueued) return;
          closeQueued = true;
          window.setTimeout(() => window.close(), 120);
        };

        window.addEventListener("afterprint", closeWindow);

        window.addEventListener("focus", () => {
          if (printHandled) closeWindow();
        });

        window.addEventListener("load", () => {
          window.setTimeout(() => {
            printHandled = true;
            window.focus();
            window.print();
          }, 120);
        });
      })();
    </script>
  </head>
  <body>
    <div class="sheet">
      <h1>${escapeHtml(title)}</h1>
      <p class="subtitle">${escapeHtml(subtitle)}</p>
      <div class="meta">${metadata.map((item) => `<span class="meta-chip">${escapeHtml(item)}</span>`).join("")}</div>
      <div class="legend">${legendItems}</div>
      <table>
        <thead>
          <tr>
            <th class="entity-cell">Entidad</th>
            ${headerDays}
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </body>
</html>`;
}

function getGridMetrics(columnCount: number) {
  if (columnCount >= 120) return { dayCellSize: 11, minDayWidth: 10, dayCellGap: 2, blockGap: 2, leftColWidth: 180 };
  if (columnCount >= 90) return { dayCellSize: 12, minDayWidth: 11, dayCellGap: 2, blockGap: 2, leftColWidth: 190 };
  if (columnCount >= 60) return { dayCellSize: 13, minDayWidth: 11, dayCellGap: 3, blockGap: 3, leftColWidth: 200 };
  if (columnCount >= 40) return { dayCellSize: 14, minDayWidth: 12, dayCellGap: 3, blockGap: 3, leftColWidth: 210 };
  if (columnCount >= 21) return { dayCellSize: 15, minDayWidth: 12, dayCellGap: 3, blockGap: 3, leftColWidth: 220 };
  return { dayCellSize: 17, minDayWidth: 12, dayCellGap: 4, blockGap: 4, leftColWidth: 220 };
}

export default function UsageGanttPage() {
  const PAGE_SIZE = 10;
  const timelineListRef = useRef<HTMLDivElement | null>(null);
  const entityFilterRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [entityRows, setEntityRows] = useState<EntityInfo[]>([]);
  const [entityOptions, setEntityOptions] = useState<Option[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<Option[]>([]);
  const [usageUnitOptions, setUsageUnitOptions] = useState<Option[]>([]);
  const [entityId, setEntityId] = useState("all");
  const [entitySearch, setEntitySearch] = useState("");
  const [entitySuggestionsOpen, setEntitySuggestionsOpen] = useState(false);
  const [entityTypeId, setEntityTypeId] = useState("all");
  const [usageUnitId, setUsageUnitId] = useState("all");
  const [rangeMode, setRangeMode] = useState<RangeMode>("preset");
  const [scale, setScale] = useState<Scale>("month");
  const [anchor, setAnchor] = useState(today);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [pageOffset, setPageOffset] = useState(0);
  const [viewportMetrics, setViewportMetrics] = useState({ scrollY: 0, height: 0, listTop: 0 });
  const [totalEntities, setTotalEntities] = useState(0);

  const presetRange = useMemo(() => getRange(anchor, scale), [anchor, scale]);
  const presetFocusRange = useMemo(() => getRange(anchor, scale), [anchor, scale]);

  useEffect(() => {
    if (rangeMode !== "preset") return;
    setDateFrom(toIsoDate(presetRange.from));
    setDateTo(toIsoDate(presetRange.to));
  }, [presetRange.from, presetRange.to, rangeMode]);

  useEffect(() => {
    const selectedEntity = entityOptions.find((option) => option.id === entityId);
    setEntitySearch(entityId === "all" ? "" : selectedEntity?.name ?? "");
  }, [entityId, entityOptions]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (entityFilterRef.current?.contains(target)) return;
      setEntitySuggestionsOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

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
  const dayGridTemplate = `repeat(${columns.length}, minmax(${gridMetrics.minDayWidth}px, 1fr))`;
  const weekBlockTemplate = `repeat(${heatmapWeeks.length}, minmax(${gridMetrics.minDayWidth * 7 + gridMetrics.dayCellGap * 6}px, 1fr))`;
  const periodLabel = useMemo(
    () => (rangeMode === "custom" ? getCustomPeriodLabel(dateFrom, dateTo) : getPresetPeriodLabel(anchor, scale)),
    [anchor, dateFrom, dateTo, rangeMode, scale]
  );
  const timelineMinWidth = useMemo(
    () => gridMetrics.leftColWidth + columns.length * gridMetrics.minDayWidth + Math.max(0, columns.length - 1) * gridMetrics.dayCellGap + 24,
    [columns.length, gridMetrics.dayCellGap, gridMetrics.leftColWidth, gridMetrics.minDayWidth]
  );
  const highlightedDates = useMemo(
    () => Array.from(new Set(rows.map((row) => row.logged_on).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))).sort(),
    [rows]
  );
  const filteredEntityOptions = useMemo(() => {
    const needle = entitySearch.trim().toLowerCase();
    if (!needle) return entityOptions.slice(0, 12);
    return entityOptions.filter((option) => option.name.toLowerCase().includes(needle)).slice(0, 12);
  }, [entityOptions, entitySearch]);

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
    qs.set("offset", String(pageOffset));
    qs.set("limit", String(PAGE_SIZE));
    if (entityId !== "all") qs.set("entity_id", entityId);
    if (entityTypeId !== "all") qs.set("entity_type_id", entityTypeId);
    if (usageUnitId !== "all") qs.set("usage_unit_id", usageUnitId);

    const res = await fetch(`/api/reporting/usage-gantt?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar el reporte cronológico de actividad.");
      setRows([]);
      setEntityRows([]);
      setTotalEntities(0);
      setLoading(false);
      return;
    }

    const nextRows = Array.isArray(json.rows) ? json.rows : [];
    const nextEntityRows = Array.isArray(json.entity_rows) ? json.entity_rows : [];
    setRows(nextRows);
    setEntityRows(nextEntityRows);
    setEntityOptions(Array.isArray(json.options?.entities) ? json.options.entities : []);
    setEntityTypeOptions(Array.isArray(json.options?.entity_types) ? json.options.entity_types : []);
    setUsageUnitOptions(Array.isArray(json.options?.usage_units) ? json.options.usage_units : []);
    setTotalEntities(Number(json.paging?.total_entities ?? 0) || 0);
    setLoading(false);
  }

  useEffect(() => {
    setPageOffset(0);
  }, [entityId, entityTypeId, usageUnitId, scale, anchor, dateFrom, dateTo, displayRange.from, displayRange.to]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, entityTypeId, usageUnitId, scale, anchor, dateFrom, dateTo, displayRange.from, displayRange.to, pageOffset]);

  const timelineRows = useMemo<TimelineRow[]>(() => {
    type TimelineAccumulator = TimelineRow & { metaByDay: Record<string, { loggedAt: string }> };
    const byEntity = new Map<string, TimelineAccumulator>();

    for (const entity of entityRows) {
      byEntity.set(entity.id, {
        entity_id: entity.id,
        entity_name: entity.name,
        entity_type_name: entity.entity_type_name,
        usage_unit_name: entity.usage_unit_name,
        usage_unit_visible: entity.usage_unit_visible !== false,
        suggestedValues: Array.isArray(entity.usage_unit_suggested_values) ? entity.usage_unit_suggested_values : [],
        detailsByDay: {},
        metaByDay: {},
        totalLoggedDays: 0,
        latestLoggedOn: null,
        latestValue: null,
      });
    }

    for (const row of rows) {
      const current: TimelineAccumulator = byEntity.get(row.entity_id) ?? {
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        entity_type_name: row.entity_type_name,
        usage_unit_name: row.usage_unit_name,
        usage_unit_visible: row.usage_unit_visible !== false,
        suggestedValues: Array.isArray(row.usage_unit_suggested_values) ? row.usage_unit_suggested_values : [],
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
          suggestedValues: Array.isArray(row.usage_unit_suggested_values) ? row.usage_unit_suggested_values : [],
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
        suggestedValues: item.suggestedValues,
        detailsByDay: item.detailsByDay,
        totalLoggedDays: Object.keys(item.detailsByDay).length,
        latestLoggedOn: item.latestLoggedOn,
        latestValue: item.latestValue,
      }));
  }, [entityRows, rows]);

  const suggestedLegend = useMemo(() => {
    const values: string[] = [];
    for (const row of timelineRows) {
      for (const value of row.suggestedValues) {
        if (!values.some((existing) => normalizeSuggestedValue(existing) === normalizeSuggestedValue(value))) {
          values.push(value);
        }
      }
    }
    return values;
  }, [timelineRows]);

  const suggestedColorMap = useMemo(() => buildSuggestedPalette(suggestedLegend), [suggestedLegend]);
  const timelineLegendItems = useMemo(() => {
    const suggestedItems = suggestedLegend
      .map((value) => {
        const color = suggestedColorMap.get(normalizeSuggestedValue(value));
        if (!color) return null;
        return {
          key: `legend-${value}`,
          label: value,
          tone: cn("border", color.border, "bg-white text-slate-700"),
          swatchClassName: cn("border", color.border, color.dot),
        };
      })
      .filter((item): item is { key: string; label: string; tone: string; swatchClassName: string } => Boolean(item));

    return [
      ...suggestedItems,
      {
        key: "legend-free-numeric",
        label: "Numérico",
        tone: "border-blue-200 bg-blue-50/70 text-blue-900",
        swatchClassName: "border border-blue-200 bg-blue-600/80",
      },
      {
        key: "legend-free-text",
        label: "Estado",
        tone: "border-zinc-300 bg-zinc-100 text-zinc-900",
        swatchClassName: "border border-zinc-300 bg-zinc-700/75",
      },
      {
        key: "legend-empty",
        label: "Sin registro",
        tone: "border-slate-200 bg-slate-50 text-slate-600",
        swatchClassName: "border border-slate-200 bg-slate-100/80",
      },
    ];
  }, [suggestedColorMap, suggestedLegend]);
  const pageStart = totalEntities === 0 ? 0 : pageOffset + 1;
  const pageEnd = Math.min(pageOffset + timelineRows.length, totalEntities);
  const hasPreviousPage = pageOffset > 0;
  const hasNextPage = pageOffset + PAGE_SIZE < totalEntities;
  const virtualRowHeight = 42;
  const virtualRowGap = 8;
  const virtualRowPitch = virtualRowHeight + virtualRowGap;
  const virtualOverscan = 8;
  const shouldVirtualizeRows = timelineRows.length > 40;
  const virtualWindow = useMemo(() => {
    if (!shouldVirtualizeRows) {
      return { start: 0, end: timelineRows.length };
    }
    const visibleTop = Math.max(0, viewportMetrics.scrollY - viewportMetrics.listTop);
    const visibleBottom = Math.max(0, viewportMetrics.scrollY + viewportMetrics.height - viewportMetrics.listTop);
    const start = Math.max(0, Math.floor(visibleTop / virtualRowPitch) - virtualOverscan);
    const end = Math.min(timelineRows.length, Math.ceil(visibleBottom / virtualRowPitch) + virtualOverscan);
    return { start, end };
  }, [shouldVirtualizeRows, timelineRows.length, viewportMetrics.height, viewportMetrics.listTop, viewportMetrics.scrollY, virtualRowPitch]);
  const virtualRows = useMemo(
    () => timelineRows.slice(virtualWindow.start, virtualWindow.end),
    [timelineRows, virtualWindow.end, virtualWindow.start]
  );
  const virtualListHeight = Math.max(0, timelineRows.length * virtualRowPitch - virtualRowGap);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let frame = 0;

    const updateViewportMetrics = () => {
      cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const listTop = timelineListRef.current
          ? timelineListRef.current.getBoundingClientRect().top + window.scrollY
          : 0;
        setViewportMetrics({
          scrollY: window.scrollY,
          height: window.innerHeight,
          listTop,
        });
      });
    };

    updateViewportMetrics();
    window.addEventListener("scroll", updateViewportMetrics, { passive: true });
    window.addEventListener("resize", updateViewportMetrics);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateViewportMetrics);
      window.removeEventListener("resize", updateViewportMetrics);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const listTop = timelineListRef.current
      ? timelineListRef.current.getBoundingClientRect().top + window.scrollY
      : 0;
    setViewportMetrics((current) => ({
      scrollY: window.scrollY,
      height: window.innerHeight,
      listTop: listTop || current.listTop,
    }));
  }, [timelineRows.length, columns.length, scale, rangeMode]);

  async function exportPdf() {
    setBusy(true);
    try {
      const entityLabel = getOptionLabel(entityOptions, entityId, "Todas las entidades");
      const entityTypeLabel = getOptionLabel(entityTypeOptions, entityTypeId, "Todos los tipos");
      const usageUnitLabel = getOptionLabel(usageUnitOptions, usageUnitId, "Todas las unidades");
      const scaleLabel = rangeMode === "preset" ? (scale === "week" ? "Semanal" : "Mensual") : "Rango personalizado";
      const title = [
        "Reporte cronológico de actividad",
        entityTypeLabel !== "Todos los tipos" ? entityTypeLabel : "",
        usageUnitLabel !== "Todas las unidades" ? usageUnitLabel : "",
        periodLabel,
      ]
        .filter(Boolean)
        .join(" · ");
      const subtitle = `Periodo: ${periodLabel} · Entidades visibles: ${timelineRows.length} · Escala: ${scaleLabel}`;
      const metadata = [
        `Entidad: ${entityLabel}`,
        `Tipo: ${entityTypeLabel}`,
        `Unidad: ${usageUnitLabel}`,
        `Periodo: ${periodLabel}`,
      ];
      const html = buildGanttPrintHtml({
        title,
        subtitle,
        metadata,
        columns,
        rows: timelineRows,
        suggestedColorMap,
        suggestedLegend,
      });
      const win = window.open("", "_blank");
      if (!win) {
        setErrorMsg("No se pudo abrir la ventana de impresión. Revisa el bloqueo de popups.");
        return;
      }
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.document.title = slugifyLabel(title) || "reporte-cronologico-de-actividad";
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-[1440px] space-y-4 px-4 py-3 sm:space-y-5">
      <PageHero
        badge="Reportes"
        secondaryBadge="Uso"
        title="Reporte cronológico de actividad"
        subtitle="Lectura temporal del uso registrado para detectar concentración, vacíos y continuidad operativa."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void exportPdf()} disabled={loading || busy}>
              Exportar PDF
            </Button>
            <Link href="/app/reports/usage/detail">
              <Button variant="outline" size="sm">Abrir vista tabular</Button>
            </Link>
            <Link href="/app/usage-capture">
              <Button variant="outline" size="sm">Captura uso</Button>
            </Link>
          </>
        }
      />

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="grid gap-2 rounded-[18px] border border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.96),rgba(241,245,249,0.88))] p-2.5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] xl:items-start">
            <section className="h-full rounded-[14px] border border-slate-200 bg-white p-2">
              <div className="mb-1 flex min-h-9 items-center">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Alcance</div>
              </div>
              <div className="grid gap-1.5 md:grid-cols-[minmax(0,1.8fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
              <label className="grid gap-0.5">
                <span className="text-[11px] text-slate-500">Entidad</span>
                <div ref={entityFilterRef} className="relative">
                  <input
                    value={entitySearch}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setEntitySearch(nextValue);
                      const matched = entityOptions.find(
                        (option) => option.name.toLowerCase() === nextValue.trim().toLowerCase()
                      );
                      setEntityId(matched?.id ?? (nextValue.trim() ? entityId : "all"));
                      if (!entitySuggestionsOpen) setEntitySuggestionsOpen(true);
                    }}
                    onFocus={() => setEntitySuggestionsOpen(true)}
                    placeholder="Buscar entidad..."
                    className={filterSelectClass()}
                  />
                  {entitySuggestionsOpen ? (
                    <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 rounded-[14px] border border-slate-200 bg-white p-1 shadow-[0_18px_32px_-24px_rgba(15,23,42,0.28)]">
                      <button
                        type="button"
                        onClick={() => {
                          setEntityId("all");
                          setEntitySearch("");
                          setEntitySuggestionsOpen(false);
                        }}
                        className="flex w-full items-center rounded-[10px] px-2.5 py-2 text-left text-[13px] text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      >
                        Todas las entidades
                      </button>
                      <div className="max-h-56 overflow-y-auto">
                        {filteredEntityOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              setEntityId(option.id);
                              setEntitySearch(option.name);
                              setEntitySuggestionsOpen(false);
                            }}
                            className="flex w-full items-center rounded-[10px] px-2.5 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                          >
                            {option.name}
                          </button>
                        ))}
                        {filteredEntityOptions.length === 0 ? (
                          <div className="px-2.5 py-2 text-[12px] text-slate-400">Sin coincidencias</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
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

            <section className="h-full rounded-[14px] border border-slate-200 bg-white p-2">
            <div className="mb-1 flex min-h-9 flex-wrap items-center justify-between gap-1.5 sm:flex-nowrap">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Periodo</div>
                <div className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {periodLabel}
                </div>
              </div>
              <div className="inline-flex h-9 rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setRangeMode("preset")}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition",
                    rangeMode === "preset" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Guiado
                </button>
                <button
                  type="button"
                  onClick={() => setRangeMode("custom")}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition",
                    rangeMode === "custom" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Rango
                </button>
              </div>
            </div>

            {rangeMode === "preset" ? (
              <div className="flex flex-wrap items-center justify-between gap-1.5 lg:flex-nowrap">
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="inline-flex h-9 rounded-full border border-slate-200 bg-slate-50 p-1">
                    {([
                      { value: "week", label: "Semanal" },
                      { value: "month", label: "Mensual" },
                    ] as Array<{ value: Scale; label: string }>).map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setScale(option.value)}
                        className={cn(
                          "inline-flex h-7 items-center rounded-full px-2 py-0.5 text-[11px] font-medium transition",
                          scale === option.value ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-700"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 justify-end">
                  <Button variant="outline" size="sm" onClick={() => setAnchor((prev) => shiftAnchor(prev, scale, -1))}>Anterior</Button>
                  <Button variant="outline" size="sm" onClick={() => setAnchor((prev) => shiftAnchor(prev, scale, 1))}>Siguiente</Button>
                  <Button variant="outline" size="sm" onClick={() => setAnchor(today())}>Hoy</Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                <MarkedDatePicker
                  value={dateFrom}
                  onChange={setDateFrom}
                  highlightedDates={highlightedDates}
                  placeholder="Desde"
                  showLegend={false}
                />
                <MarkedDatePicker
                  value={dateTo}
                  onChange={setDateTo}
                  highlightedDates={highlightedDates}
                  placeholder="Hasta"
                  showLegend={false}
                />
              </div>
            )}
            </section>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader label="Construyendo reporte cronológico..." />
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
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">Mapa de actividad</CardTitle>
                  {totalEntities > 0 ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {`Mostrando ${pageStart}-${pageEnd} de ${totalEntities}`}
                    </span>
                  ) : null}
                </div>
                <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Leyenda</div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {timelineLegendItems.map((item) => (
                  <div key={item.key} className={cn("inline-flex items-center gap-2 rounded-full border px-2.5 py-1", item.tone)}>
                    <span className={cn("h-3 w-3 rounded-[4px]", item.swatchClassName)} />
                    {item.label}
                  </div>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {timelineRows.length === 0 ? (
              <p className="app-empty">No hay entidades para los filtros seleccionados.</p>
            ) : (
              <div className="overflow-x-auto md:overflow-visible">
                <div className="space-y-2" style={{ minWidth: `${timelineMinWidth}px` }}>
                  <div className="grid items-end gap-2 rounded-xl bg-slate-50 px-3 py-2" style={{ gridTemplateColumns: `${gridMetrics.leftColWidth}px minmax(0,1fr)` }}>
                    <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Entidad</div>
                    <div className="space-y-1">
                      {scale === "month" ? (
                        <div className="grid" style={{ gap: `${gridMetrics.blockGap}px`, gridTemplateColumns: weekBlockTemplate }}>
                          {heatmapWeeks.map((week) => (
                            <div key={`header-block-${week.key}`} className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                              {week.label}
                              {week.secondaryLabel ? <span className="ml-1 normal-case tracking-normal text-slate-300">{week.secondaryLabel}</span> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="grid" style={{ gap: `${gridMetrics.dayCellGap}px`, gridTemplateColumns: dayGridTemplate }}>
                          {columns.map((column) => (
                          <div key={`header-day-${column.key}`} className={cn("text-center text-[10px] font-medium text-slate-400", contextTone(column.inFocus))}>
                            <div>{column.label}</div>
                            <div className="text-[9px] text-slate-300">{column.secondary}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div ref={timelineListRef} className="relative" style={{ height: `${virtualListHeight}px` }}>
                    {virtualRows.map((row, visibleIndex) => {
                      const rowIndex = virtualWindow.start + visibleIndex;
                      return (
                        <section
                          key={row.entity_id}
                          className="absolute left-0 right-0 grid items-center gap-2 rounded-xl border border-slate-200 bg-white/85 px-3 py-1.5 shadow-sm"
                          style={{
                            top: `${rowIndex * virtualRowPitch}px`,
                            height: `${virtualRowHeight}px`,
                            gridTemplateColumns: `${gridMetrics.leftColWidth}px minmax(0,1fr)`,
                          }}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold leading-tight text-slate-900">{row.entity_name}</div>
                          </div>

                          <div className="space-y-1">
                            {scale === "month" ? (
                              <div className="grid" style={{ gap: `${gridMetrics.blockGap}px`, gridTemplateColumns: weekBlockTemplate }}>
                                {heatmapWeeks.map((week) => (
                                  <div key={`${row.entity_id}-block-${week.key}`} className="h-1 rounded-full bg-slate-100" />
                                ))}
                              </div>
                            ) : null}
                            <div className="grid" style={{ gap: `${gridMetrics.dayCellGap}px`, gridTemplateColumns: dayGridTemplate }}>
                              {columns.map((column) => {
                                const detail = row.detailsByDay[column.key] ?? null;
                                const value = detail?.value ?? null;
                                const suggestedColor = detail?.value
                                  ? suggestedColorMap.get(normalizeSuggestedValue(detail.value)) ?? null
                                  : null;
                                return (
                                  <div
                                    key={`${row.entity_id}-${column.key}`}
                                    className={cn(
                                      "group relative rounded-[4px] border",
                                      value ? "hover:scale-110 hover:shadow-sm" : "",
                                      heatmapTone(value, true, suggestedColor),
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
                      );
                    })}
                  </div>
                </div>
                {totalEntities > PAGE_SIZE ? (
                  <div className="flex items-center justify-center gap-2 border-t border-slate-100 pt-3">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 rounded-full"
                      onClick={() => setPageOffset((current) => Math.max(0, current - PAGE_SIZE))}
                      disabled={!hasPreviousPage || loading}
                      aria-label="Página anterior"
                      title="Página anterior"
                    >
                      <DirectionIcon direction="left" />
                    </Button>
                    <div className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-600">
                      {pageStart}-{pageEnd} / {totalEntities}
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10 rounded-full"
                      onClick={() => setPageOffset((current) => current + PAGE_SIZE)}
                      disabled={!hasNextPage || loading}
                      aria-label="Página siguiente"
                      title="Página siguiente"
                    >
                      <DirectionIcon direction="right" />
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
