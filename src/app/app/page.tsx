"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { BarChart, DonutChart, TrendLineChart } from "@/components/charts/echarts";
import { Loader } from "@/components/ui/loader";
import { Badge } from "@/components/ui/badge";
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
  analytics_mode: "distribution" | "trend" | "count";
  total: number;
  values: Array<{ label: string; count: number }>;
};

type DashboardExecutiveSummary = {
  lines: string[];
  updated_at: string | null;
  executive_comment: {
    text: string | null;
    model: string | null;
    updated_at: string | null;
  };
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

const statusColor: Record<Status, string> = {
  red: "#f43f5e",
  orange: "#f97316",
  yellow: "#f59e0b",
  green: "#10b981",
  none: "#94a3b8",
};

function MetricTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: React.ReactNode;
  tone?: "neutral" | "danger" | "healthy";
}) {
  const valueClass =
    tone === "danger"
      ? "text-rose-700"
      : tone === "healthy"
        ? "text-emerald-700"
        : "text-slate-900";

  return (
    <div className="rounded-[18px] border border-slate-200/80 bg-white px-3.5 py-3 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.35)]">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className={`mt-1.5 text-xl font-semibold tracking-tight sm:text-2xl ${valueClass}`}>{value}</div>
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
  const [executiveSummary, setExecutiveSummary] = useState<DashboardExecutiveSummary | null>(null);

  async function load() {
    setLoading(true);
    setErrorMsg("");

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const [dashboardRes, summaryRes] = await Promise.all([
      fetch("/api/dashboard?mode=analytics", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/dashboard/summary-text", { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    const json = await dashboardRes.json().catch(() => ({}));
    const summaryJson = await summaryRes.json().catch(() => ({}));
    if (!dashboardRes.ok) {
      setErrorMsg(json.error || "No se pudo cargar información analítica.");
      setEntities([]);
      setMeta(null);
      setDynamicDistributionByEntityType({});
      setExecutiveSummary(null);
      setLoading(false);
      return;
    }

    setEntities((json.entities ?? []) as EntityRow[]);
    setMeta((json.meta ?? null) as DashboardMeta | null);
    setDynamicDistributionByEntityType(
      (json.dynamic_distribution_by_entity_type ?? {}) as Record<string, DynamicFieldDistribution[]>
    );
    setExecutiveSummary(
      summaryRes.ok
        ? {
            lines: Array.isArray(summaryJson.lines) ? summaryJson.lines.map((line: unknown) => String(line ?? "")).filter(Boolean).slice(0, 3) : [],
            updated_at: summaryJson.updated_at ? String(summaryJson.updated_at) : null,
            executive_comment: {
              text:
                summaryJson.executive_comment && typeof summaryJson.executive_comment.text === "string"
                  ? String(summaryJson.executive_comment.text)
                  : null,
              model:
                summaryJson.executive_comment && typeof summaryJson.executive_comment.model === "string"
                  ? String(summaryJson.executive_comment.model)
                  : null,
              updated_at:
                summaryJson.executive_comment && typeof summaryJson.executive_comment.updated_at === "string"
                  ? String(summaryJson.executive_comment.updated_at)
                  : null,
            },
          }
        : null
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
    if (entityTypeFilter === "all") return [] as Array<{
      fieldId: string;
      title: string;
      mode: "distribution" | "trend" | "count";
      slices: DonutSlice[];
      points: Array<{ label: string; value: number }>;
    }>;
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
        if (row.analytics_mode === "trend") {
          return {
            fieldId: row.field_id,
            title: row.field_name,
            mode: row.analytics_mode,
            slices: [],
            points: row.values.map((item) => ({ label: item.label, value: item.count })),
          };
        }
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
        return {
          fieldId: row.field_id,
          title: row.field_name,
          mode: row.analytics_mode,
          slices,
          points: slices.map((s) => ({ label: s.label, value: s.value })),
        };
      })
      .filter((row) => (row.mode === "trend" ? row.points.length > 0 : row.slices.length > 0));
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

  const isAllTypesView = entityTypeFilter === "all";
  const selectedEntityTypeName = useMemo(() => {
    if (isAllTypesView) return "Todos los tipos";
    return entityTypes.find((t) => t.id === entityTypeFilter)?.name ?? "Tipo seleccionado";
  }, [entityTypeFilter, entityTypes, isAllTypesView]);
  const dueNext30Total = useMemo(() => dueTrend30.reduce((acc, row) => acc + row.count, 0), [dueTrend30]);
  const withoutForecast = Math.max(0, totals.total - totals.withForecast);
  const attentionNow = countsByStatus.red + countsByStatus.orange;
  const dueTrendPoints = useMemo(
    () => dueTrend30.map((row) => ({ label: row.day.slice(5), value: row.count })),
    [dueTrend30]
  );
  const compactSummary = isAllTypesView
    ? `${meta?.entity_count_in_org ?? entities.length} entidades, ${totals.coverage}% con forecast, ${countsByStatus.red} vencidas, ${countsByStatus.orange} por vencer`
    : `${selectedEntityTypeName}: ${filtered.length} entidades, ${totals.coverage}% con forecast, ${countsByStatus.red} vencidas`;

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-[1400px] items-center justify-center px-4 py-4">
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
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <section className="rounded-[26px] border border-[rgba(17,32,28,0.08)] bg-[linear-gradient(180deg,rgba(251,253,252,0.98),rgba(245,249,248,0.96))] p-4 shadow-[0_20px_60px_-44px_rgba(15,23,42,0.3)]">
        <div className="grid gap-3 xl:grid-cols-[minmax(220px,0.9fr)_minmax(0,2fr)_minmax(260px,1.1fr)] xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-900 text-white hover:bg-slate-900">Dashboard</Badge>
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                {isAllTypesView ? "Vista global" : selectedEntityTypeName}
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Centro analítico
            </h1>
            <p className="mt-1 text-sm text-slate-500">{compactSummary}</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <MetricTile label="Total entidades" value={totals.total} />
            <MetricTile label="Con forecast" value={totals.withForecast} />
            <MetricTile label="Vencidas" value={totals.overdue} tone="danger" />
            <MetricTile label="Al día" value={totals.healthy} tone="healthy" />
            <MetricTile label="Cobertura" value={`${totals.coverage}%`} />
          </div>

          <div className="min-w-0 rounded-[20px] border border-slate-200/80 bg-white px-4 py-3">
            <label className="grid gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Tipo de entidad
              <select
                value={entityTypeFilter}
                onChange={(e) => {
                  setEntityTypeFilter(e.target.value);
                }}
                className="h-11 w-full rounded-2xl border border-[var(--input)] bg-white px-3 text-sm text-slate-800"
              >
                <option value="all">Todos los tipos</option>
                {entityTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{filtered.length} visibles</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{withoutForecast} sin forecast</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">{dueNext30Total} próximos 30 días</span>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4">
        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Resumen ejecutivo</div>
              <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100">
                Sistema
              </Badge>
            </div>
            <CardTitle className="text-left text-base sm:text-lg">Estado general del sistema</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {executiveSummary?.lines?.length ? (
              <div className="space-y-2 text-sm leading-6 text-slate-700">
                {executiveSummary.lines.map((line, index) => (
                  <p key={`${index}-${line}`}>{line}</p>
                ))}
              </div>
            ) : (
              <p className="app-empty">El resumen ejecutivo todavía no está disponible.</p>
            )}
            {executiveSummary?.updated_at ? (
              <p className="text-xs text-slate-500">
                Actualizado {new Date(executiveSummary.updated_at).toLocaleString(undefined, { timeZone: "UTC" })}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Comentario ejecutivo</div>
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                IA
              </Badge>
            </div>
            <CardTitle className="text-left text-base sm:text-lg">Lectura gerencial</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {executiveSummary?.executive_comment?.text ? (
              <p className="text-sm leading-7 text-slate-700">{executiveSummary.executive_comment.text}</p>
            ) : (
              <p className="app-empty">El comentario ejecutivo narrado todavía no está disponible.</p>
            )}
            {executiveSummary?.executive_comment?.updated_at ? (
              <p className="text-xs text-slate-500">
                Actualizado {new Date(executiveSummary.executive_comment.updated_at).toLocaleString(undefined, { timeZone: "UTC" })}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
          <CardHeader className="pb-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Semáforo</div>
            <CardTitle className="text-left text-base sm:text-lg">
              {isAllTypesView ? "Distribución por estado" : `Distribución por estado · ${selectedEntityTypeName}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <DonutChart slices={statusDonutSlices} centerLabel="Distribución por estado" />
          </CardContent>
        </Card>

        {isAllTypesView ? (
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
            <CardHeader className="pb-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Comparativa</div>
              <CardTitle className="text-left text-base sm:text-lg">Top por tipo de entidad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {byEntityType.length === 0 ? <p className="app-empty">Sin datos para graficar.</p> : null}
              {byEntityType.length > 0 ? <DonutChart slices={entityTypeDonutSlices} centerLabel="Top por tipo de entidad" /> : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
            <CardHeader className="pb-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Modo</div>
              <CardTitle className="text-left text-base sm:text-lg">Vista enfocada</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="app-empty">
                Estás viendo solo los gráficos asociados a <b>{selectedEntityTypeName}</b>.
              </p>
            </CardContent>
          </Card>
        )}

        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
          <CardHeader className="pb-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Presión de agenda</div>
            <CardTitle className="text-left text-base sm:text-lg">
              {isAllTypesView
                ? "Tendencia próximos 30 días"
                : `Tendencia próximos 30 días · ${selectedEntityTypeName}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-[18px] bg-[rgba(215,243,239,0.35)] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Ventana</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">30 días</div>
              </div>
              <div className="rounded-[18px] bg-[rgba(215,243,239,0.35)] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Eventos</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{dueNext30Total}</div>
              </div>
              <div className="rounded-[18px] bg-[rgba(215,243,239,0.35)] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Picos</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{attentionNow}</div>
              </div>
            </div>

            {dueTrend30.length === 0 ? (
              <p className="app-empty">No hay vencimientos previstos en los próximos 30 días con los filtros actuales.</p>
            ) : (
              <TrendLineChart points={dueTrendPoints} />
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
        <CardHeader className="pb-2">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Analítica</div>
          <CardTitle className="text-left text-base sm:text-lg">Campos dinámicos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {entityTypeFilter === "all" ? (
            <p className="app-empty">Selecciona un tipo de entidad para ver gráficos de campos dinámicos configurados en modo analítico.</p>
          ) : dynamicFieldCharts.length === 0 ? (
            <p className="app-empty">No hay campos dinámicos con modo analítico (`distribution`, `trend` o `count`) para este tipo.</p>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {dynamicFieldCharts.map((chart) => (
                <div key={chart.fieldId} className="rounded-[22px] border border-[rgba(17,32,28,0.08)] bg-[rgba(237,244,240,0.65)] p-4">
                  <div className="mb-1 text-sm font-semibold text-slate-700">{chart.title}</div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.16em] text-slate-500">{chart.mode}</div>
                  {chart.mode === "distribution" ? (
                    <DonutChart slices={chart.slices} centerLabel={chart.title} />
                  ) : null}
                  {chart.mode === "count" ? <BarChart points={chart.points} /> : null}
                  {chart.mode === "trend" ? <TrendLineChart points={chart.points} /> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
