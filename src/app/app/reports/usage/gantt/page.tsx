"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Scale = "month" | "quarter" | "year";

type Option = {
  id: string;
  name: string;
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
};

type TimelineRow = {
  entity_id: string;
  entity_name: string;
  entity_type_name: string;
  usage_unit_name: string;
  usage_unit_visible: boolean;
  valuesByBucket: Record<string, string>;
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

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shiftAnchor(anchor: Date, scale: Scale, delta: number) {
  if (scale === "month") return addMonths(anchor, delta);
  if (scale === "quarter") return addMonths(anchor, delta * 3);
  return new Date(anchor.getFullYear() + delta, 0, 1);
}

function getRange(anchor: Date, scale: Scale) {
  if (scale === "month") return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
  if (scale === "quarter") return { from: startOfQuarter(anchor), to: endOfQuarter(anchor) };
  return { from: startOfYear(anchor), to: endOfYear(anchor) };
}

function getPeriodLabel(anchor: Date, scale: Scale) {
  if (scale === "month") return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  if (scale === "quarter") return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`;
  return String(anchor.getFullYear());
}

function getColumns(anchor: Date, scale: Scale) {
  if (scale === "month") {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    const count = end.getDate();
    return Array.from({ length: count }, (_, idx) => {
      const date = new Date(start.getFullYear(), start.getMonth(), idx + 1);
      return {
        key: toIsoDate(date),
        label: String(idx + 1),
        secondary: date.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 2),
      };
    });
  }

  const start = scale === "quarter" ? startOfQuarter(anchor) : startOfYear(anchor);
  const months = scale === "quarter" ? 3 : 12;
  return Array.from({ length: months }, (_, idx) => {
    const date = new Date(start.getFullYear(), start.getMonth() + idx, 1);
    return {
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString(undefined, { month: "short" }),
      secondary: String(date.getFullYear()),
    };
  });
}

function bucketForLoggedOn(loggedOn: string, scale: Scale) {
  if (scale === "month") return loggedOn;
  return loggedOn.slice(0, 7);
}

function cellTone(value: string) {
  if (value === "—") return "bg-white text-slate-300";
  if (/^\d+(\.\d+)?$/.test(value)) return "bg-sky-100 text-sky-900";
  return "bg-emerald-100 text-emerald-900";
}

export default function UsageGanttPage() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [entityOptions, setEntityOptions] = useState<Option[]>([]);
  const [entityTypeOptions, setEntityTypeOptions] = useState<Option[]>([]);
  const [usageUnitOptions, setUsageUnitOptions] = useState<Option[]>([]);
  const [entityId, setEntityId] = useState("all");
  const [entityTypeId, setEntityTypeId] = useState("all");
  const [usageUnitId, setUsageUnitId] = useState("all");
  const [scale, setScale] = useState<Scale>("month");
  const [anchor, setAnchor] = useState(today);

  const range = useMemo(() => getRange(anchor, scale), [anchor, scale]);
  const columns = useMemo(() => getColumns(anchor, scale), [anchor, scale]);

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
    qs.set("date_from", toIsoDate(range.from));
    qs.set("date_to", toIsoDate(range.to));
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
      setLoading(false);
      return;
    }

    setRows(Array.isArray(json.rows) ? json.rows : []);
    setEntityOptions(Array.isArray(json.options?.entities) ? json.options.entities : []);
    setEntityTypeOptions(Array.isArray(json.options?.entity_types) ? json.options.entity_types : []);
    setUsageUnitOptions(Array.isArray(json.options?.usage_units) ? json.options.usage_units : []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, entityTypeId, usageUnitId, scale, anchor]);

  const timelineRows = useMemo<TimelineRow[]>(() => {
    const byEntity = new Map<string, TimelineRow & { metaByBucket: Record<string, { loggedAt: string }> }>();
    for (const row of rows) {
      const bucket = bucketForLoggedOn(row.logged_on, scale);
      const current = byEntity.get(row.entity_id) ?? {
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        entity_type_name: row.entity_type_name,
        usage_unit_name: row.usage_unit_name,
        usage_unit_visible: row.usage_unit_visible !== false,
        valuesByBucket: {},
        metaByBucket: {},
      };
      const previousLoggedAt = current.metaByBucket[bucket]?.loggedAt ? Date.parse(current.metaByBucket[bucket].loggedAt) : Number.NEGATIVE_INFINITY;
      const nextLoggedAt = row.logged_at ? Date.parse(row.logged_at) : Number.NEGATIVE_INFINITY;
      if (!current.valuesByBucket[bucket] || nextLoggedAt >= previousLoggedAt) {
        current.valuesByBucket[bucket] = row.value_display;
        current.metaByBucket[bucket] = { loggedAt: row.logged_at };
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
        valuesByBucket: item.valuesByBucket,
      }));
  }, [rows, scale]);

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Carta Gantt de registro de uso</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Vista horizontal por entidad con valores registrados en el tiempo.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app/reports/usage">
                <Button variant="outline" size="sm">Volver a Reportes</Button>
              </Link>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
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
          <select value={usageUnitId} onChange={(e) => setUsageUnitId(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm">
            <option value="all">Todas las unidades</option>
            {usageUnitOptions.map((option) => (
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
            <Button variant="outline" size="sm" onClick={() => setAnchor(today())}>Hoy</Button>
          </div>
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
            <CardTitle className="text-base">Vista temporal</CardTitle>
          </CardHeader>
          <CardContent>
            {timelineRows.length === 0 ? (
              <p className="app-empty">No hay registros de uso para el periodo y filtros seleccionados.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <table className="min-w-[1200px] w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-[11px] text-slate-500">
                      <th className="px-3 py-2 text-left font-medium">Entidad</th>
                      <th className="px-3 py-2 text-left font-medium">Tipo</th>
                      <th className="px-3 py-2 text-left font-medium">Unidad</th>
                      {columns.map((column) => (
                        <th key={column.key} className="px-2 py-2 text-center font-medium whitespace-nowrap">
                          <div>{column.label}</div>
                          <div className="text-[10px] text-slate-400">{column.secondary}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {timelineRows.map((row) => (
                      <tr key={row.entity_id} className="border-b">
                        <td className="px-3 py-2 font-medium text-slate-900 whitespace-nowrap">{row.entity_name}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.entity_type_name}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                          {row.usage_unit_visible === false ? "" : (row.usage_unit_name || "—")}
                        </td>
                        {columns.map((column) => {
                          const value = row.valuesByBucket[column.key] ?? "—";
                          return (
                            <td key={`${row.entity_id}-${column.key}`} className="px-1 py-1">
                              <div
                                className={cn(
                                  "flex min-h-9 min-w-[52px] items-center justify-center rounded-md border px-1 text-xs font-medium",
                                  cellTone(value)
                                )}
                                title={value === "—" ? undefined : value}
                              >
                                {value}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
