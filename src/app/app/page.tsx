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
  const [dynamicDistributionByEntityType, setDynamicDistributionByEntityType] = useState<Record<string, DynamicFieldDistribution[]>>({});
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("all");
  const [executiveSummary, setExecutiveSummary] = useState<DashboardExecutiveSummary | null>(null);
  const [summaryView, setSummaryView] = useState<"ai" | "system">("ai");
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);

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
      setDynamicDistributionByEntityType({});
      setExecutiveSummary(null);
      setLoading(false);
      return;
    }

    setEntities((json.entities ?? []) as EntityRow[]);
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
    if (summaryRes.ok) {
      const hasAiComment =
        summaryJson.executive_comment &&
        typeof summaryJson.executive_comment.text === "string" &&
        String(summaryJson.executive_comment.text).trim().length > 0;
      setSummaryView(hasAiComment ? "ai" : "system");
    } else {
      setSummaryView("system");
    }
    setSummaryModalOpen(false);
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
  const attentionNow = countsByStatus.red + countsByStatus.orange;
  const dueTrendPoints = useMemo(
    () => dueTrend30.map((row) => ({ label: row.day.slice(5), value: row.count })),
    [dueTrend30]
  );
  const hasAiExecutiveComment = Boolean(executiveSummary?.executive_comment?.text?.trim());
  const showingAiSummary = hasAiExecutiveComment && summaryView === "ai";
  const visibleSummaryText = showingAiSummary
    ? executiveSummary?.executive_comment?.text ?? ""
    : executiveSummary?.lines?.join(" ") ?? "";
  const visibleSummaryUpdatedAt = showingAiSummary
    ? executiveSummary?.executive_comment?.updated_at ?? null
    : executiveSummary?.updated_at ?? null;
  const summaryNeedsClamp = visibleSummaryText.length > (showingAiSummary ? 180 : 140);
  const shouldShowDynamicFields = entityTypeFilter !== "all" && dynamicFieldCharts.length > 0;

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
    <main className="mx-auto max-w-[1400px] space-y-3 px-4 py-3">
      <section className="rounded-[26px] border border-[rgba(17,32,28,0.08)] bg-[linear-gradient(180deg,rgba(251,253,252,0.98),rgba(245,249,248,0.96))] p-3.5 shadow-[0_20px_60px_-44px_rgba(15,23,42,0.3)]">
        <div className="grid gap-2.5 xl:grid-cols-[minmax(220px,0.9fr)_minmax(0,2fr)_minmax(260px,1.1fr)] xl:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-900 text-white hover:bg-slate-900">Dashboard</Badge>
              <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                {isAllTypesView ? "Vista global" : selectedEntityTypeName}
              </Badge>
            </div>
            <h1 className="mt-2 text-[1.05rem] font-semibold tracking-tight text-slate-900 sm:text-[1.35rem]">
              Centro analítico
            </h1>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            <MetricTile label="Total entidades" value={totals.total} />
            <MetricTile label="Con forecast" value={totals.withForecast} />
            <MetricTile label="Vencidas" value={totals.overdue} tone="danger" />
            <MetricTile label="Al día" value={totals.healthy} tone="healthy" />
            <MetricTile label="Cobertura" value={`${totals.coverage}%`} />
          </div>

          <div className="min-w-0 rounded-[20px] border border-slate-200/80 bg-white px-3.5 py-2.5">
            <label className="grid gap-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Tipo de entidad
              <select
                value={entityTypeFilter}
                onChange={(e) => {
                  setEntityTypeFilter(e.target.value);
                }}
                className="h-10 w-full rounded-2xl border border-[var(--input)] bg-white px-3 text-sm text-slate-800"
              >
                <option value="all">Todos los tipos</option>
                {entityTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-[28px] border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_28%),linear-gradient(160deg,#020617_0%,#0f172a_62%,#022c22_100%)] shadow-[0_26px_64px_-46px_rgba(2,6,23,0.9)]">
        <div className="px-5 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSummaryView("system")}
                className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] transition ${
                  !showingAiSummary
                    ? "border-white/20 bg-white text-slate-950"
                    : "border-white/10 bg-white/5 text-emerald-200 hover:bg-white/10"
                }`}
              >
                Sistema
              </button>
              <button
                type="button"
                onClick={() => {
                  if (hasAiExecutiveComment) setSummaryView("ai");
                }}
                disabled={!hasAiExecutiveComment}
                className={`rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] transition ${
                  showingAiSummary
                    ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"
                    : hasAiExecutiveComment
                      ? "border-white/10 bg-white/5 text-emerald-200 hover:bg-white/10"
                      : "cursor-not-allowed border-white/5 bg-white/5 text-slate-500"
                }`}
              >
                IA
              </button>
              <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-200/75">
                {showingAiSummary ? "Comentario ejecutivo" : "Resumen operativo"}
              </span>
            </div>
            <div className="mt-1.5">
              {visibleSummaryText ? (
                <div className="space-y-2">
                  {summaryNeedsClamp ? (
                    <div>
                      <p
                        className="overflow-hidden text-[15px] leading-7 text-slate-100 sm:text-[16px]"
                        style={{
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: 2,
                        }}
                      >
                        {visibleSummaryText}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[15px] leading-7 text-slate-100 sm:text-[16px]">
                      {visibleSummaryText}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm leading-6 text-slate-300">
                  {showingAiSummary
                    ? "El comentario ejecutivo narrado todavía no está disponible."
                    : "El resumen del sistema todavía no está disponible."}
                </p>
              )}
            </div>
            {visibleSummaryUpdatedAt || summaryNeedsClamp ? (
              <div className="mt-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="text-emerald-100/75">
                  {visibleSummaryUpdatedAt
                    ? `Actualizado ${new Date(visibleSummaryUpdatedAt).toLocaleString(undefined, { timeZone: "UTC" })}`
                    : ""}
                </div>
                {summaryNeedsClamp ? (
                  <button
                    type="button"
                    onClick={() => setSummaryModalOpen(true)}
                    className="shrink-0 whitespace-nowrap font-medium uppercase tracking-[0.18em] text-emerald-200/85 transition hover:text-emerald-100"
                  >
                    Leer más
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
          <CardHeader className="pb-2">
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Semáforo</div>
            <CardTitle className="text-left text-sm sm:text-base">
              {isAllTypesView ? "Distribución por estado" : `Distribución por estado · ${selectedEntityTypeName}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            <DonutChart slices={statusDonutSlices} centerLabel="Distribución por estado" />
          </CardContent>
        </Card>

        {isAllTypesView ? (
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
            <CardHeader className="pb-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Comparativa</div>
              <CardTitle className="text-left text-sm sm:text-base">Top por tipo de entidad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {byEntityType.length === 0 ? <p className="app-empty">Sin datos para graficar.</p> : null}
              {byEntityType.length > 0 ? <DonutChart slices={entityTypeDonutSlices} centerLabel="Top por tipo de entidad" /> : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
            <CardHeader className="pb-2">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Modo</div>
              <CardTitle className="text-left text-sm sm:text-base">Vista enfocada</CardTitle>
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
            <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted-foreground)]">Presión de agenda</div>
            <CardTitle className="text-left text-sm sm:text-base">
              {isAllTypesView
                ? "Tendencia próximos 30 días"
                : `Tendencia próximos 30 días · ${selectedEntityTypeName}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-[18px] bg-[rgba(215,243,239,0.35)] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Ventana</div>
                <div className="mt-0.5 text-base font-semibold text-slate-900">30 días</div>
              </div>
              <div className="rounded-[18px] bg-[rgba(215,243,239,0.35)] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Eventos</div>
                <div className="mt-0.5 text-base font-semibold text-slate-900">{dueNext30Total}</div>
              </div>
              <div className="rounded-[18px] bg-[rgba(215,243,239,0.35)] px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Picos</div>
                <div className="mt-0.5 text-base font-semibold text-slate-900">{attentionNow}</div>
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

      {shouldShowDynamicFields ? (
        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.82)]">
          <CardHeader className="pb-2">
            <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Analítica</div>
            <CardTitle className="text-left text-base sm:text-lg">Campos dinámicos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
          </CardContent>
        </Card>
      ) : null}

      {summaryModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-[28px] border border-emerald-500/20 bg-[linear-gradient(160deg,#020617_0%,#0f172a_62%,#022c22_100%)] shadow-[0_30px_80px_-44px_rgba(2,6,23,0.95)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="secondary"
                  className={showingAiSummary ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/10" : "bg-white text-slate-950 hover:bg-white"}
                >
                  {showingAiSummary ? "IA" : "Sistema"}
                </Badge>
                <span className="text-[11px] uppercase tracking-[0.2em] text-emerald-200/75">
                  {showingAiSummary ? "Comentario ejecutivo" : "Resumen operativo"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSummaryModalOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-slate-200 transition hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
              <p className="text-[15px] leading-8 text-slate-100 sm:text-[16px]">
                {visibleSummaryText}
              </p>
              {visibleSummaryUpdatedAt ? (
                <div className="mt-4 text-xs text-emerald-100/75">
                  Actualizado {new Date(visibleSummaryUpdatedAt).toLocaleString(undefined, { timeZone: "UTC" })}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
