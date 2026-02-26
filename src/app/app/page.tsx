"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type EntityType = { id: string; name: string };
type Status = "red" | "orange" | "yellow" | "green" | "none";

type EntityRow = {
  id: string;
  name: string;
  entity_type_id: string | null;
  entity_types?: EntityType | null;
  nearest_forecast?: {
    risk_level: Status;
    forecast_due_date: string | null;
    days_remaining: number | null;
  } | null;
};

type DashboardMeta = {
  entity_count_in_org: number;
};

type DynamicFieldDistribution = {
  field_id: string;
  field_name: string;
  total: number;
  values: Array<{ label: string; count: number }>;
};

type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

const statusLabel: Record<Status, string> = {
  red: "Vencido",
  orange: "Por vencer",
  yellow: "Aviso",
  green: "Al día",
  none: "Sin info",
};

const statusTone: Record<Status, string> = {
  red: "bg-rose-500",
  orange: "bg-orange-500",
  yellow: "bg-amber-500",
  green: "bg-emerald-500",
  none: "bg-slate-400",
};

const statusColor: Record<Status, string> = {
  red: "#f43f5e",
  orange: "#f97316",
  yellow: "#f59e0b",
  green: "#10b981",
  none: "#94a3b8",
};

function buildDonutGradient(slices: DonutSlice[]) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  if (total <= 0) return "conic-gradient(#e2e8f0 0deg 360deg)";
  let acc = 0;
  const parts: string[] = [];
  for (const s of slices) {
    if (s.value <= 0) continue;
    const start = (acc / total) * 360;
    acc += s.value;
    const end = (acc / total) * 360;
    parts.push(`${s.color} ${start}deg ${end}deg`);
  }
  return `conic-gradient(${parts.join(", ")})`;
}

function DonutChart({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel: string }) {
  const total = slices.reduce((acc, s) => acc + s.value, 0);
  const gradient = buildDonutGradient(slices);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative h-40 w-40 shrink-0 self-center rounded-full" style={{ background: gradient }}>
        <div className="absolute inset-[18%] flex items-center justify-center rounded-full bg-white text-center">
          <div>
            <div className="text-[11px] text-slate-500">Total</div>
            <div className="text-lg font-semibold text-slate-800">{total}</div>
          </div>
        </div>
      </div>
      <div className="grid min-w-0 gap-1 text-xs text-slate-600">
        {slices.map((s) => {
          const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
          return (
            <div key={s.label} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="truncate">{s.label}</span>
              </div>
              <span className="shrink-0">{s.value} ({pct}%)</span>
            </div>
          );
        })}
      </div>
      <span className="sr-only">{centerLabel}</span>
    </div>
  );
}

export default function AnalyticsDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [meta, setMeta] = useState<DashboardMeta | null>(null);
  const [dynamicDistributionByEntityType, setDynamicDistributionByEntityType] = useState<Record<string, DynamicFieldDistribution[]>>({});
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");

  async function load() {
    setLoading(true);
    setErrorMsg("");

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/dashboard?mode=analytics", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar información analítica.");
      setEntities([]);
      setMeta(null);
      setDynamicDistributionByEntityType({});
      setLoading(false);
      return;
    }

    setEntities((json.entities ?? []) as EntityRow[]);
    setMeta((json.meta ?? null) as DashboardMeta | null);
    setDynamicDistributionByEntityType(
      (json.dynamic_distribution_by_entity_type ?? {}) as Record<string, DynamicFieldDistribution[]>
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onRefresh() {
      void load();
    }
    window.addEventListener("dashboard-refresh", onRefresh);
    return () => window.removeEventListener("dashboard-refresh", onRefresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entityTypes = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) {
      const id = e.entity_type_id ?? "";
      const name = e.entity_types?.name ?? "Sin tipo";
      if (id) map.set(id, name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entities]);

  const filtered = useMemo(() => {
    return entities.filter((e) => {
      if (entityTypeFilter !== "all" && e.entity_type_id !== entityTypeFilter) return false;
      return true;
    });
  }, [entities, entityTypeFilter]);

  const countsByStatus = useMemo(() => {
    const base: Record<Status, number> = { red: 0, orange: 0, yellow: 0, green: 0, none: 0 };
    for (const e of filtered) {
      const status = e.nearest_forecast?.risk_level ?? "none";
      base[status] += 1;
    }
    return base;
  }, [filtered]);

  const totals = useMemo(() => {
    const total = filtered.length;
    const withForecast = filtered.filter((e) => Boolean(e.nearest_forecast)).length;
    const overdue = countsByStatus.red;
    const healthy = countsByStatus.green;
    const coverage = total > 0 ? Math.round((withForecast / total) * 100) : 0;
    return { total, withForecast, overdue, healthy, coverage };
  }, [filtered, countsByStatus]);

  const byEntityType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of filtered) {
      const key = e.entity_types?.name ?? "Sin tipo";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const arr = Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
    return arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [filtered]);

  const statusDonutSlices = useMemo<DonutSlice[]>(
    () =>
      (["red", "orange", "yellow", "green", "none"] as Status[]).map((s) => ({
        label: statusLabel[s],
        value: countsByStatus[s],
        color: statusColor[s],
      })),
    [countsByStatus]
  );

  const entityTypeDonutSlices = useMemo<DonutSlice[]>(() => {
    const palette = [
      "#6366f1",
      "#0ea5e9",
      "#10b981",
      "#f59e0b",
      "#f97316",
      "#ef4444",
      "#8b5cf6",
      "#14b8a6",
    ];
    const top = byEntityType.slice(0, 7);
    const rest = byEntityType.slice(7).reduce((acc, row) => acc + row.count, 0);
    const slices: DonutSlice[] = top.map((row, idx) => ({
      label: row.name,
      value: row.count,
      color: palette[idx % palette.length],
    }));
    if (rest > 0) {
      slices.push({ label: "Otros", value: rest, color: "#94a3b8" });
    }
    return slices;
  }, [byEntityType]);

  const dynamicFieldCharts = useMemo(() => {
    if (entityTypeFilter === "all") return [] as Array<{ title: string; slices: DonutSlice[] }>;
    const rows = dynamicDistributionByEntityType[entityTypeFilter] ?? [];
    const palette = [
      "#0ea5e9",
      "#10b981",
      "#f59e0b",
      "#f97316",
      "#ef4444",
      "#8b5cf6",
      "#14b8a6",
      "#6366f1",
    ];

    return rows
      .filter((row) => row.total > 0)
      .map((row) => {
        const top = row.values.slice(0, 7);
        const rest = row.values.slice(7).reduce((acc, item) => acc + item.count, 0);
        const slices: DonutSlice[] = top.map((item, idx) => ({
          label: item.label,
          value: item.count,
          color: palette[idx % palette.length],
        }));
        if (rest > 0) {
          slices.push({ label: "Otros", value: rest, color: "#94a3b8" });
        }
        return { title: row.field_name, slices };
      })
      .filter((row) => row.slices.length > 0);
  }, [dynamicDistributionByEntityType, entityTypeFilter]);

  const dueTrend30 = useMemo(() => {
    const buckets = new Map<string, number>();
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 30);

    for (const e of filtered) {
      const due = e.nearest_forecast?.forecast_due_date;
      if (!due) continue;
      const d = new Date(due);
      if (Number.isNaN(d.getTime())) continue;
      if (d < now || d > end) continue;
      const day = due.slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }

    return Array.from(buckets.entries())
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }, [filtered]);

  if (loading) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-4">
        <Loader label="Cargando dashboard analítico..." />
      </main>
    );
  }

  if (errorMsg) {
    return (
      <main className="mx-auto max-w-[1400px] px-4 py-4">
        <Card>
          <CardHeader>
            <CardTitle>Dashboard</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="app-alert app-alert-error">{errorMsg}</div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <section className="rounded-xl border bg-white px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center gap-2">
          <label className="app-page-title shrink-0">Dashboard</label>
          <select
            value={entityTypeFilter}
            onChange={(e) => setEntityTypeFilter(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm"
          >
            <option value="all">Todos los tipos</option>
            {entityTypes.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      </section>

      <div className="grid grid-cols-5 gap-2 sm:gap-3">
        <Card>
          <CardContent className="flex min-h-[92px] flex-col items-center justify-center gap-1 px-1 py-2 text-center sm:min-h-[110px] sm:gap-2 sm:px-4 sm:py-3">
            <div className="flex h-7 items-center justify-center text-[10px] leading-tight text-slate-500 sm:h-auto sm:text-xs">Total entidades</div>
            <div className="text-lg font-semibold tabular-nums sm:text-2xl">{totals.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex min-h-[92px] flex-col items-center justify-center gap-1 px-1 py-2 text-center sm:min-h-[110px] sm:gap-2 sm:px-4 sm:py-3">
            <div className="flex h-7 items-center justify-center text-[10px] leading-tight text-slate-500 sm:h-auto sm:text-xs">Con forecast</div>
            <div className="text-lg font-semibold tabular-nums sm:text-2xl">{totals.withForecast}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex min-h-[92px] flex-col items-center justify-center gap-1 px-1 py-2 text-center sm:min-h-[110px] sm:gap-2 sm:px-4 sm:py-3">
            <div className="flex h-7 items-center justify-center text-[10px] leading-tight text-slate-500 sm:h-auto sm:text-xs">Vencidas</div>
            <div className="text-lg font-semibold tabular-nums text-rose-700 sm:text-2xl">{totals.overdue}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex min-h-[92px] flex-col items-center justify-center gap-1 px-1 py-2 text-center sm:min-h-[110px] sm:gap-2 sm:px-4 sm:py-3">
            <div className="flex h-7 items-center justify-center text-[10px] leading-tight text-slate-500 sm:h-auto sm:text-xs">Al día</div>
            <div className="text-lg font-semibold tabular-nums text-emerald-700 sm:text-2xl">{totals.healthy}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex min-h-[92px] flex-col items-center justify-center gap-1 px-1 py-2 text-center sm:min-h-[110px] sm:gap-2 sm:px-4 sm:py-3">
            <div className="flex h-7 items-center justify-center text-[10px] leading-tight text-slate-500 sm:h-auto sm:text-xs">Cobertura</div>
            <div className="text-lg font-semibold tabular-nums sm:text-2xl">{totals.coverage}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-center text-base">Distribución por estado</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <DonutChart slices={statusDonutSlices} centerLabel="Distribución por estado" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-center text-base">Top por tipo de entidad</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {byEntityType.length === 0 ? <p className="app-empty">Sin datos para graficar.</p> : null}
            {byEntityType.length > 0 ? <DonutChart slices={entityTypeDonutSlices} centerLabel="Top por tipo de entidad" /> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-center text-base">Campos dinámicos (gráficos)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {entityTypeFilter === "all" ? (
            <p className="app-empty text-center">Selecciona un tipo de entidad para ver gráficos de campos dinámicos configurados en modo analítico.</p>
          ) : dynamicFieldCharts.length === 0 ? (
            <p className="app-empty text-center">No hay campos dinámicos con modo analítico `distribution` para este tipo.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {dynamicFieldCharts.map((chart) => (
                <div key={chart.title} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 text-sm font-semibold text-slate-700">{chart.title}</div>
                  <DonutChart slices={chart.slices} centerLabel={chart.title} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-center text-base">Tendencia próximos 30 días (vencimientos previstos)</CardTitle></CardHeader>
        <CardContent>
          {dueTrend30.length === 0 ? (
            <p className="app-empty">No hay vencimientos previstos en los próximos 30 días con los filtros actuales.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {dueTrend30.map((d) => (
                <div key={d.day} className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <div className="text-xs text-slate-500">{d.day}</div>
                  <div className="text-lg font-semibold">{d.count}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-center text-base">Contexto</CardTitle></CardHeader>
        <CardContent className="text-center text-xs text-slate-500">
          Entidades en organización: <b>{meta?.entity_count_in_org ?? entities.length}</b>. Este dashboard es analítico; la operación diaria se mantiene en <b>Operaciones</b>.
        </CardContent>
      </Card>
    </main>
  );
}
