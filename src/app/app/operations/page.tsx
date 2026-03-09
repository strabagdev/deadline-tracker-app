"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type EntityType = { id: string; name: string };
type NearestForecast = {
  deadline_id: string;
  deadline_name: string;
  measure_by: "date" | "usage" | "unknown";
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: Status;
  risk_score: number;
};

type EntityRow = {
  id: string;
  name: string;
  created_at: string;
  entity_type_id: string | null;
  entity_types?: EntityType | null;
  card_fields?: Array<{ name: string; value_text: string }>;
  nearest_forecast?: NearestForecast | null;
};

type LatestUsageByEntity = Record<string, { value: number; logged_at: string }>;

type DashboardMeta = {
  active_org_id: string;
  role: string;
  entity_count_in_org: number;
  filtered_count?: number;
  page?: number;
  page_size?: number | null;
  status_counts?: Partial<Record<Status, number>>;
  secondary_options?: Array<{ value: string; count: number }>;
};

type Status = "red" | "orange" | "yellow" | "green" | "none";

type SemaphoreSettings = {
  yellow_days: number;
  orange_days: number;
  red_days: number;
  label_green: string;
  label_yellow: string;
  label_orange: string;
  label_red: string;
};
type ViewMode = "cards" | "list";

type IconProps = {
  className?: string;
};

function IconList({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("h-4 w-4", className)} aria-hidden>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </svg>
  );
}

function IconGrid({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("h-4 w-4", className)} aria-hidden>
      <rect x="3" y="3" width="8" height="8" rx="1.5" />
      <rect x="13" y="3" width="8" height="8" rx="1.5" />
      <rect x="3" y="13" width="8" height="8" rx="1.5" />
      <rect x="13" y="13" width="8" height="8" rx="1.5" />
    </svg>
  );
}


function IconStatus({ status }: { status: Status | "all" }) {
  if (status === "all") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
        <path d="M4 5h16" />
        <path d="M7 12h10" />
        <path d="M10 19h4" />
      </svg>
    );
  }

  const colorClass =
    status === "red"
      ? "text-rose-600"
      : status === "orange"
        ? "text-orange-600"
        : status === "yellow"
          ? "text-amber-500"
          : status === "green"
            ? "text-emerald-600"
            : "text-slate-400";

  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cn("h-3.5 w-3.5", colorClass)} aria-hidden>
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString();
}

function statusPriority(s: Status) {
  if (s === "red") return 0;
  if (s === "orange") return 1;
  if (s === "yellow") return 2;
  if (s === "green") return 3;
  return 4;
}

function statusTone(s: Status): { border: string; soft: string; strong: string } {
  if (s === "red") return { border: "#f5c2c2", soft: "#fff2f2", strong: "#b91c1c" };
  if (s === "orange") return { border: "#ffd4b8", soft: "#fff5ee", strong: "#c2410c" };
  if (s === "yellow") return { border: "#ffe39c", soft: "#fff9e8", strong: "#a16207" };
  if (s === "green") return { border: "#c7ebc7", soft: "#f1fff1", strong: "#166534" };
  return { border: "#e2e8f0", soft: "#f8fafc", strong: "#475569" };
}

export default function OperationsPage() {
  const router = useRouter();

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [meta, setMeta] = useState<DashboardMeta | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterSecondary, setFilterSecondary] = useState<string>("all");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [dashboardPanelCollapsed, setDashboardPanelCollapsed] = useState(true);
  const [secondaryMenuOpen, setSecondaryMenuOpen] = useState(false);

  const [semaphore, setSemaphore] = useState<SemaphoreSettings>({
    yellow_days: 60,
    orange_days: 30,
    red_days: 15,
    label_green: "Al día",
    label_yellow: "Aviso",
    label_orange: "Por vencer",
    label_red: "Vencido",
  });

  const statusFilterMeta = useMemo<Array<{ key: Status | "all"; title: string }>>(
    () => [
      { key: "all", title: "Todos" },
      { key: "red", title: semaphore.label_red || "Vencido" },
      { key: "orange", title: semaphore.label_orange || "Por vencer" },
      { key: "yellow", title: semaphore.label_yellow || "Aviso" },
      { key: "green", title: semaphore.label_green || "Al día" },
      { key: "none", title: "Sin info" },
    ],
    [semaphore.label_green, semaphore.label_yellow, semaphore.label_orange, semaphore.label_red]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setErrorMsg("");

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const params = new URLSearchParams({ mode: "operations", page: String(page), page_size: String(pageSize) });
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterEntityType !== "all") params.set("entity_type_id", filterEntityType);
    if (filterSecondary !== "all") params.set("secondary", filterSecondary);
    if (q.trim()) params.set("q", q.trim());

    const res = await fetch(`/api/dashboard?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar operaciones");
      setEntities([]);
      setUsage({});
      setMeta(null);
      setLoading(false);
      return;
    }

    setMeta(json.meta ?? null);
    setEntities(json.entities ?? []);
    setUsage(json.latest_usage_by_entity ?? {});

    const sres = await fetch("/api/settings/semaphore", { headers: { Authorization: `Bearer ${token}` } });
    const sjson = await sres.json().catch(() => ({}));
    if (sres.ok && sjson?.settings) {
      setSemaphore({
        yellow_days: Number(sjson.settings.yellow_days ?? 60),
        orange_days: Number(sjson.settings.orange_days ?? 30),
        red_days: Number(sjson.settings.red_days ?? 15),
        label_green: String(sjson.settings.label_green ?? "Al día"),
        label_yellow: String(sjson.settings.label_yellow ?? "Aviso"),
        label_orange: String(sjson.settings.label_orange ?? "Por vencer"),
        label_red: String(sjson.settings.label_red ?? "Vencido"),
      });
    }

    setLoading(false);
  }, [filterEntityType, filterSecondary, filterStatus, page, pageSize, q, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const handler = () => {
      void load();
    };
    window.addEventListener("dashboard-refresh", handler);
    return () => window.removeEventListener("dashboard-refresh", handler);
  }, [load]);

  const entityTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) {
      const t = e.entity_types;
      if (t?.id) map.set(t.id, t.name);
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [entities]);

  const computedAll = useMemo(() => {
    return entities.map((e) => {
      const latest = usage[e.id]?.value ?? null;
      const latestAt = usage[e.id]?.logged_at ?? null;
      const nf = e.nearest_forecast ?? null;
      const hasActiveDeadlines = Boolean(nf);
      const status: Status = nf?.risk_level ?? "none";
      const nearest = nf
        ? {
            due: nf.forecast_due_date ? new Date(nf.forecast_due_date) : null,
            label:
              nf.risk_level === "red"
                ? semaphore.label_red
                : nf.risk_level === "orange"
                  ? semaphore.label_orange
                  : nf.risk_level === "yellow"
                    ? semaphore.label_yellow
                    : nf.risk_level === "green"
                      ? semaphore.label_green
                      : "Sin info",
            typeName: nf.deadline_name ?? "Sin tipo",
            measureBy: nf.measure_by,
          }
        : null;
      return { entity: e, latestUsage: latest, latestUsageAt: latestAt, nearest, status, hasActiveDeadlines };
    });
  }, [entities, usage, semaphore.label_green, semaphore.label_orange, semaphore.label_red, semaphore.label_yellow]);

  const statusCounts = useMemo(() => {
    const fromMeta = meta?.status_counts;
    if (fromMeta) {
      const red = Number(fromMeta.red ?? 0);
      const orange = Number(fromMeta.orange ?? 0);
      const yellow = Number(fromMeta.yellow ?? 0);
      const green = Number(fromMeta.green ?? 0);
      const none = Number(fromMeta.none ?? 0);
      return { red, orange, yellow, green, none, total: red + orange + yellow + green + none };
    }

    let red = 0;
    let orange = 0;
    let yellow = 0;
    let green = 0;
    let none = 0;
    for (const r of computedAll) {
      if (r.status === "red") red++;
      else if (r.status === "orange") orange++;
      else if (r.status === "yellow") yellow++;
      else if (r.status === "green") green++;
      else none++;
    }
    return { red, orange, yellow, green, none, total: computedAll.length };
  }, [computedAll, meta?.status_counts]);

  const secondaryFilterOptions = useMemo(() => {
    if (Array.isArray(meta?.secondary_options)) {
      return meta.secondary_options;
    }
    const counts = new Map<string, number>();
    for (const row of computedAll) {
      const values = new Set((row.entity.card_fields ?? []).map((f) => String(f.value_text ?? "").trim()).filter((v) => v.length > 0));
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, "es", { sensitivity: "base" }));
  }, [computedAll, meta?.secondary_options]);

  const rows = useMemo(() => {
    const out = [...computedAll];
    out.sort((a, b) => {
      const pa = statusPriority(a.status);
      const pb = statusPriority(b.status);
      if (pa !== pb) return pa - pb;

      const da = a.nearest?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const db = b.nearest?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;

      return a.entity.name.localeCompare(b.entity.name);
    });

    return out;
  }, [computedAll]);

  const totalRowsForPagination = Math.max(0, Number(meta?.filtered_count ?? rows.length));
  const effectivePageSize = Number(meta?.page_size ?? pageSize);
  const totalPages = Math.max(1, Math.ceil(totalRowsForPagination / Math.max(1, effectivePageSize)));
  const safePage = Math.min(Number(meta?.page ?? page), totalPages);
  const pageStart = totalRowsForPagination === 0 ? 0 : (safePage - 1) * effectivePageSize;
  const pagedRows = rows;
  const groupedPagedRows = useMemo(() => {
    const map = new Map<string, typeof pagedRows>();
    for (const row of pagedRows) {
      const typeName = row.entity.entity_types?.name ?? "Sin tipo";
      const current = map.get(typeName) ?? [];
      current.push(row);
      map.set(typeName, current);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "Sin tipo") return 1;
      if (b === "Sin tipo") return -1;
      return a.localeCompare(b, "es", { sensitivity: "base" });
    });
  }, [pagedRows]);

  const hasEntities = (meta?.entity_count_in_org ?? entities.length) > 0;
  const hasActiveFilters =
    q.trim().length > 0 || filterEntityType !== "all" || filterStatus !== "all" || filterSecondary !== "all";

  function countByStatus(s: Status | "all") {
    if (s === "all") return statusCounts.total;
    if (s === "red") return statusCounts.red;
    if (s === "orange") return statusCounts.orange;
    if (s === "yellow") return statusCounts.yellow;
    if (s === "green") return statusCounts.green;
    return statusCounts.none;
  }

  function statusChipClasses(s: Status | "all", active: boolean) {
    const tone =
      s === "red"
        ? "!border-rose-300 !bg-rose-100 !text-rose-800 hover:!bg-rose-200"
        : s === "orange"
          ? "!border-orange-300 !bg-orange-100 !text-orange-800 hover:!bg-orange-200"
          : s === "yellow"
            ? "!border-amber-300 !bg-amber-100 !text-amber-800 hover:!bg-amber-200"
            : s === "green"
              ? "!border-emerald-300 !bg-emerald-100 !text-emerald-800 hover:!bg-emerald-200"
              : s === "none"
                ? "!border-slate-300 !bg-slate-100 !text-slate-700 hover:!bg-slate-200"
                : "!border-blue-300 !bg-blue-100 !text-blue-800 hover:!bg-blue-200";

    return cn(
      "min-w-[54px] justify-center border font-semibold",
      tone,
      active ? "!border-slate-500 opacity-100" : "opacity-80"
    );
  }

  function renderSecondaryFilter(placementClassName?: string, menuClassName?: string) {
    if (secondaryFilterOptions.length === 0) return null;
    return (
      <div className={cn("relative z-20", placementClassName)}>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSecondaryMenuOpen((v) => !v)}
            className="min-h-[var(--control-h)]"
          >
            <span>Filtro secundario</span>
            <span className="text-xs">{secondaryMenuOpen ? "▲" : "▼"}</span>
          </Button>
          {filterSecondary !== "all" ? (
            <Badge variant="outline" className="max-w-[280px] truncate border-indigo-300 bg-indigo-50 text-indigo-800">
              {filterSecondary}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">
              Todos
            </Badge>
          )}
        </div>

        {secondaryMenuOpen ? (
          <div className={cn("mt-2 max-h-44 overflow-auto rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--card)] p-2 shadow-sm z-30", menuClassName)}>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setFilterSecondary("all");
                  setPage(1);
                  setSecondaryMenuOpen(false);
                }}
                className={cn(
                  "min-w-[54px] shrink-0 justify-center border font-semibold",
                  filterSecondary === "all"
                    ? "!border-indigo-500 !bg-indigo-100 !text-indigo-800"
                    : "!border-slate-300 !bg-slate-100 !text-slate-700 hover:!bg-slate-200"
                )}
                title="Todos los valores"
              >
                <span>Todos</span>
              </Button>
              {secondaryFilterOptions.map((opt) => (
                <Button
                  key={opt.value}
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFilterSecondary(opt.value);
                    setPage(1);
                    setSecondaryMenuOpen(false);
                  }}
                  className={cn(
                    "min-w-[54px] shrink-0 justify-center border font-semibold",
                    filterSecondary === opt.value
                      ? "!border-indigo-500 !bg-indigo-100 !text-indigo-800"
                      : "!border-slate-300 !bg-slate-100 !text-slate-700 hover:!bg-slate-200"
                  )}
                  title={opt.value}
                >
                  <span className="max-w-[180px] truncate">{opt.value}</span>
                  <span className="font-semibold">{opt.count}</span>
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
            <CardTitle className="app-page-title shrink-0">Operaciones</CardTitle>

            <div className="min-w-0 lg:flex-1">
              <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1 pr-2 lg:w-max lg:pb-0">
                {statusFilterMeta.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setFilterStatus(s.key);
                      setPage(1);
                    }}
                    className={statusChipClasses(s.key, filterStatus === s.key)}
                    title={s.title}
                  >
                    <IconStatus status={s.key} />
                    {filterStatus === s.key ? <span>✓</span> : null}
                    <span className="hidden sm:inline">{s.title}</span>
                    <span className="font-semibold">{countByStatus(s.key)}</span>
                  </Button>
                ))}
              </div>
              {renderSecondaryFilter("mt-2 md:hidden")}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {renderSecondaryFilter("hidden md:block", "md:absolute md:right-0 md:min-w-[360px]")}
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDashboardPanelCollapsed((v) => !v)}
                className="min-w-[116px] justify-between"
              >
                <span>{dashboardPanelCollapsed ? "Buscar" : "Ocultar"}</span>
                <span className="text-xs">{dashboardPanelCollapsed ? "▼" : "▲"}</span>
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-3">
          {!dashboardPanelCollapsed ? (
            <div className="mt-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--muted)]/80 px-3 py-2 sm:px-4 sm:py-3">
              <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_150px_auto]">
                <Input
                  id="dashboard_search"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Buscar por nombre, tipo o vencimiento..."
                />
                <select
                  id="dashboard_page_size"
                  aria-label="Filas por página"
                  value={String(pageSize)}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
                >
                  <option value="25">25 / página</option>
                  <option value="50">50 / página</option>
                  <option value="100">100 / página</option>
                </select>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setFilterEntityType("all");
                    setFilterStatus("all");
                    setFilterSecondary("all");
                    setPage(1);
                  }}
                  disabled={!hasActiveFilters}
                >
                  Limpiar filtros
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {errorMsg ? <div className="app-alert app-alert-error whitespace-pre-wrap">{errorMsg}</div> : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            id="dashboard_type_quick"
            aria-label="Filtrar por tipo"
            value={filterEntityType}
            onChange={(e) => {
              setFilterEntityType(e.target.value);
              setPage(1);
            }}
            className="h-[var(--control-h)] min-w-[170px] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
          >
            <option value="all">Todos los tipos</option>
            {entityTypeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant={viewMode === "cards" ? "secondary" : "outline"}
            onClick={() => setViewMode("cards")}
            className="min-h-[var(--control-h)] min-w-[var(--control-h)]"
            title="Vista tarjetas"
            aria-label="Vista tarjetas"
          >
            <IconGrid />
          </Button>
          <Button
            size="sm"
            variant={viewMode === "list" ? "secondary" : "outline"}
            onClick={() => setViewMode("list")}
            className="min-h-[var(--control-h)] min-w-[var(--control-h)]"
            title="Vista lista"
            aria-label="Vista lista"
          >
            <IconList />
          </Button>
        </div>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader label="Cargando operaciones..." />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              {!hasEntities ? (
                <p className="app-empty">Aún no hay entidades. Crea tu primera entidad para comenzar.</p>
              ) : (
                <p className="app-empty">No hay entidades para mostrar con estos filtros.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {viewMode === "cards" ? (
              <div className="space-y-3">
                {groupedPagedRows.map(([typeName, typeRows]) => (
                  <section key={typeName} className="space-y-2">
                    <div className="sticky top-0 z-10 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--card)]/92 px-3 py-1 text-xs font-semibold text-[var(--muted-foreground)] backdrop-blur">
                      {typeName}
                    </div>
                    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                      {typeRows.map((r) => {
                  const e = r.entity;
                  const nearest = r.nearest;
                  const tone = statusTone(r.status);
                  const hasLatestUsage = r.latestUsage != null;
                  const hasLatestUsageAt = Boolean(r.latestUsageAt);
                  const cardFields = (e.card_fields ?? []).filter(
                    (f) => String(f.name ?? "").trim() !== "" && String(f.value_text ?? "").trim() !== ""
                  );
                  const dueLabel = !r.hasActiveDeadlines
                    ? "—"
                    : nearest?.due
                      ? fmtDate(nearest.due)
                      : "Sin fecha estimada";

                        return (
                          <article
                            key={e.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => router.push(`/app/entities/${e.id}`)}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter" || ev.key === " ") {
                                ev.preventDefault();
                                router.push(`/app/entities/${e.id}`);
                              }
                            }}
                          className="grid min-h-[112px] cursor-pointer content-between gap-1.5 rounded-[var(--radius-lg)] border p-2.5 shadow-sm transition-shadow hover:shadow-md"
                            style={{ borderColor: tone.border, background: tone.soft }}
                            title="Abrir ficha"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant="outline" className="text-[11px] font-semibold" style={{ borderColor: tone.border, color: tone.strong }}>
                                {r.hasActiveDeadlines ? nearest?.label ?? "Sin info" : "Sin vencimientos"}
                              </Badge>
                              <div className="text-[11px] font-medium text-slate-600">{dueLabel}</div>
                            </div>

                            <div className="min-w-0">
                              <div className="truncate text-[14px] font-semibold leading-tight text-slate-900">{e.name}</div>
                              <div className="mt-0.5 truncate text-[11px] text-slate-500">{e.entity_types?.name ?? "Sin tipo"}</div>
                              {cardFields.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {cardFields.slice(0, 3).map((field, idx) => (
                                    <Badge key={`${e.id}-${field.name}-${field.value_text}-${idx}`} variant="outline" className="bg-white text-[10px] font-normal text-slate-600">
                                      {field.value_text}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5">
                              {r.hasActiveDeadlines ? (
                                <Badge variant="outline" className="bg-white text-[10px] font-medium text-slate-600">
                                  {`${nearest?.typeName ?? "Sin tipo"}${
                                    nearest?.measureBy === "usage"
                                      ? " · uso"
                                      : nearest?.measureBy === "date"
                                        ? " · fecha"
                                        : ""
                                  }`}
                                </Badge>
                              ) : null}
                              {hasLatestUsage ? (
                                <Badge variant="outline" className="bg-white text-[10px] font-medium text-slate-700">
                                  Uso: {r.latestUsage}
                                </Badge>
                              ) : null}
                              {hasLatestUsageAt ? (
                                <Badge variant="outline" className="bg-white text-[10px] font-medium text-slate-700">
                                  Último: {new Date(r.latestUsageAt as string).toLocaleDateString()}
                                </Badge>
                              ) : null}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-2xl border bg-white">
                <div className="grid grid-cols-[1.3fr_0.95fr_1.55fr_0.8fr] border-b bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  <div>Entidad</div>
                  <div>Estado</div>
                  <div>Próximo vencimiento</div>
                  <div className="text-right">Uso</div>
                </div>
                {groupedPagedRows.map(([typeName, typeRows]) => (
                  <React.Fragment key={typeName}>
                    <div className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100">{typeName}</div>
                    {typeRows.map((r) => {
                      const e = r.entity;
                      const nearest = r.nearest;
                      const tone = statusTone(r.status);
                      const cardFields = (e.card_fields ?? []).filter((f) => String(f.value_text ?? "").trim() !== "");
                      return (
                        <div
                          key={e.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => router.push(`/app/entities/${e.id}`)}
                          onKeyDown={(ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              router.push(`/app/entities/${e.id}`);
                            }
                          }}
                          className="grid cursor-pointer grid-cols-[1.3fr_0.95fr_1.55fr_0.8fr] items-center gap-0 border-b px-3 py-2.5 text-sm transition-colors hover:bg-slate-50"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900">{e.name}</div>
                            <div className="truncate text-[11px] text-slate-500">{e.entity_types?.name ?? "Sin tipo"}</div>
                          </div>
                          <div>
                            <Badge variant="outline" className="font-semibold" style={{ borderColor: tone.border, color: tone.strong }}>
                              {r.hasActiveDeadlines ? nearest?.label ?? "Sin info" : "Sin vencimientos"}
                            </Badge>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-slate-900">
                              {!r.hasActiveDeadlines
                                ? "—"
                                : nearest?.due
                                  ? fmtDate(nearest.due)
                                  : "Sin fecha estimada"}
                            </div>
                            <div className="truncate text-[11px] text-slate-500">
                              {!r.hasActiveDeadlines
                                ? ""
                                : `${nearest?.typeName ?? "Sin tipo"}${
                                    nearest?.measureBy === "usage"
                                      ? " · por uso"
                                      : nearest?.measureBy === "date"
                                        ? " · por fecha"
                                        : ""
                                  }`}
                            </div>
                            {cardFields.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {cardFields.slice(0, 2).map((field, idx) => (
                                  <Badge key={`${e.id}-${field.name}-${field.value_text}-${idx}`} variant="outline" className="bg-slate-50 text-[10px] font-normal text-slate-600">
                                    {field.value_text}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <div className="text-[13px] font-medium text-slate-800">{r.latestUsage != null ? r.latestUsage : "—"}</div>
                            <div className="text-[11px] text-slate-500">
                              {r.latestUsageAt ? new Date(r.latestUsageAt).toLocaleDateString() : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2">
              <div className="text-xs text-slate-500">
                Mostrando {totalRowsForPagination === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + effectivePageSize, totalRowsForPagination)} de {totalRowsForPagination}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  variant="outline"
                  size="sm"
                  className="h-[var(--control-h)] min-w-[var(--control-h)] px-2"
                  title="Página anterior"
                  aria-label="Página anterior"
                >
                  ◀
                </Button>
                <div className="px-1 text-xs text-slate-600">Página {safePage} de {totalPages}</div>
                <Button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  variant="outline"
                  size="sm"
                  className="h-[var(--control-h)] min-w-[var(--control-h)] px-2"
                  title="Página siguiente"
                  aria-label="Página siguiente"
                >
                  ▶
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
