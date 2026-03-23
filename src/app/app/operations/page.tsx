"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHero } from "@/components/PageHero";
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
  semaphore?: SemaphoreSettings | null;
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

function IconClearFilters({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("h-4 w-4", className)} aria-hidden>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}


function IconStatusGlyph({ status }: { status: Status | "all" }) {
  if (status === "all") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 scale-[1.75]" aria-hidden>
        <path d="M4 7h16" />
        <path d="M7 12h10" />
        <path d="M10 17h4" />
      </svg>
    );
  }

  if (status === "red") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 scale-[1.75]" aria-hidden>
        <path d="M15 9 9 15" />
        <path d="m9 9 6 6" />
      </svg>
    );
  }

  if (status === "orange") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 scale-[1.75]" aria-hidden>
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
        <path d="M10.3 3.8 3.9 15a2 2 0 0 0 1.7 3h12.8a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      </svg>
    );
  }

  if (status === "yellow") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 scale-[1.75]" aria-hidden>
        <circle cx="12" cy="12" r="7" />
        <path d="M12 8v4l2.5 1.5" />
      </svg>
    );
  }

  if (status === "green") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 scale-[1.75]" aria-hidden>
        <path d="m7 12 3 3 7-7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 scale-[1.75]" aria-hidden>
      <path d="M8 12h8" />
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

function statusFilterPalette(s: Status) {
  if (s === "red") return "border-rose-300 bg-rose-100 text-rose-800";
  if (s === "orange") return "border-orange-300 bg-orange-100 text-orange-800";
  if (s === "yellow") return "border-amber-300 bg-amber-100 text-amber-800";
  if (s === "green") return "border-emerald-300 bg-emerald-100 text-emerald-800";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function statusLegendSwatch(s: Status) {
  if (s === "red") return "border-rose-300 bg-rose-100";
  if (s === "orange") return "border-orange-300 bg-orange-100";
  if (s === "yellow") return "border-amber-300 bg-amber-100";
  if (s === "green") return "border-emerald-300 bg-emerald-100";
  return "border-slate-300 bg-slate-100";
}

function statusControlPalette(s: Status | "all") {
  if (s === "all") return "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return statusFilterPalette(s);
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
  const [selectedEntityId, setSelectedEntityId] = useState("");

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

    const params = new URLSearchParams({
      mode: "operations",
      view_mode: viewMode,
      page: String(page),
      page_size: String(pageSize),
    });
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
    if (json?.meta?.semaphore) {
      setSemaphore({
        yellow_days: Number(json.meta.semaphore.yellow_days ?? 60),
        orange_days: Number(json.meta.semaphore.orange_days ?? 30),
        red_days: Number(json.meta.semaphore.red_days ?? 15),
        label_green: String(json.meta.semaphore.label_green ?? "Al día"),
        label_yellow: String(json.meta.semaphore.label_yellow ?? "Aviso"),
        label_orange: String(json.meta.semaphore.label_orange ?? "Por vencer"),
        label_red: String(json.meta.semaphore.label_red ?? "Vencido"),
      });
    }

    setLoading(false);
  }, [filterEntityType, filterSecondary, filterStatus, page, pageSize, q, router, viewMode]);

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
  const selectedRow = useMemo(() => {
    if (!selectedEntityId) return null;
    return pagedRows.find((row) => row.entity.id === selectedEntityId) ?? null;
  }, [pagedRows, selectedEntityId]);
  const effectiveSelectedEntityId = selectedRow?.entity.id ?? "";

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

  function statusCircleClasses(s: Status | "all", active: boolean) {
    return cn(
      "relative h-11 w-11 shrink-0 rounded-full border shadow-sm transition focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2",
      statusControlPalette(s),
      active ? "border-slate-500 ring-2 ring-slate-900/70 ring-offset-2" : "opacity-90"
    );
  }

  function renderSecondaryFilter() {
    if (secondaryFilterOptions.length === 0) return null;
    return (
      <select
        id="dashboard_secondary_filter"
        aria-label="Filtro secundario"
        value={filterSecondary}
        onChange={(e) => {
          setFilterSecondary(e.target.value);
          setPage(1);
        }}
        className="h-[var(--control-h)] min-w-[170px] max-w-[220px] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
      >
        <option value="all">Secundario: todos</option>
        {secondaryFilterOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.value} ({opt.count})
          </option>
        ))}
      </select>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <PageHero
        badge="Operación"
        secondaryBadge="Seguimiento"
        title="Operaciones"
        subtitle="Control visual del estado operativo y acceso directo al detalle por entidad."
      />

      <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3 shadow-[0_10px_30px_-26px_rgba(15,23,42,0.28)]">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <div className="min-w-[240px] flex-[1.2]">
          <Input
            id="dashboard_search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Buscar por nombre, tipo o vencimiento..."
            className="w-full"
          />
            </div>

            <div className="flex items-center gap-2">
            {statusFilterMeta.map((s) => (
              <Button
                key={s.key}
                variant="outline"
                onClick={() => {
                  setFilterStatus(s.key);
                  setPage(1);
                }}
                className={cn("p-0", statusCircleClasses(s.key, filterStatus === s.key))}
                title={`${s.title}: ${countByStatus(s.key)}`}
                aria-label={`${s.title}: ${countByStatus(s.key)}`}
              >
                <IconStatusGlyph status={s.key} />
              </Button>
            ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {renderSecondaryFilter()}

              <select
                id="dashboard_type_quick"
                aria-label="Filtrar por tipo"
                value={filterEntityType}
                onChange={(e) => {
                  setFilterEntityType(e.target.value);
                  setPage(1);
                }}
                className="h-[var(--control-h)] min-w-[160px] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
              >
                <option value="all">Tipos: todos</option>
                {entityTypeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
          <select
            id="dashboard_page_size"
            aria-label="Filas por página"
            value={String(pageSize)}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
            className="h-[var(--control-h)] min-w-[128px] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
          >
            <option value="25">25 / página</option>
            <option value="50">50 / página</option>
            <option value="100">100 / página</option>
            <option value="250">250 / página</option>
            <option value="500">500 / página</option>
          </select>

            <div className="flex shrink-0 items-center gap-2 rounded-[14px] border border-slate-200 bg-slate-50 p-1">
            <Button
              size="sm"
              variant={viewMode === "cards" ? "secondary" : "outline"}
              onClick={() => setViewMode("cards")}
              className="min-h-[var(--control-h)] min-w-[var(--control-h)]"
              title="Vista mosaico"
              aria-label="Vista mosaico"
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
              className="min-h-[var(--control-h)] min-w-[var(--control-h)] shrink-0"
              title="Limpiar filtros"
              aria-label="Limpiar filtros"
            >
              <IconClearFilters />
            </Button>
          </div>
        </div>
      </div>

      {errorMsg ? <div className="app-alert app-alert-error whitespace-pre-wrap">{errorMsg}</div> : null}

      <section className="space-y-4">
        {loading ? (
          <div className="flex min-h-[60vh] items-center justify-center py-6">
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
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-3">
                  <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Leyenda del mosaico</div>
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        {statusFilterMeta.filter((item) => item.key !== "all").map((item) => {
                          return (
                            <div key={`legend-inline-${item.key}`} className="inline-flex items-center gap-2 text-slate-600">
                              <span className={cn("h-3 w-3 rounded-[4px] border", statusLegendSwatch(item.key as Status))} />
                              {item.title}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {groupedPagedRows.map(([typeName, typeRows]) => (
                    <section key={typeName} className="space-y-2">
                      <div className="rounded-[18px] border border-slate-200 bg-white p-3">
                        <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                          <div className="text-xs font-semibold text-[var(--muted-foreground)]">{typeName}</div>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{typeRows.length}</span>
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(16px,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(18px,1fr))]">
                          {typeRows.map((r) => {
                            const e = r.entity;
                            const nearest = r.nearest;
                            const selected = effectiveSelectedEntityId === e.id;
                            const palette = statusFilterPalette(r.status);
                            const dueLabel = !r.hasActiveDeadlines
                              ? "Sin vencimientos"
                              : nearest?.due
                                ? fmtDate(nearest.due)
                                : "Sin fecha estimada";
                            return (
                              <button
                                key={e.id}
                                type="button"
                                onClick={() => setSelectedEntityId(e.id)}
                                className={cn(
                                  "aspect-square min-h-4 rounded-[5px] border transition hover:scale-[1.08]",
                                  palette,
                                  selected && "ring-2 ring-sky-300 ring-offset-1"
                                )}
                                title={`${e.name} · ${nearest?.label ?? "Sin info"} · ${dueLabel}`}
                                aria-label={`${e.name}: ${nearest?.label ?? "Sin info"}`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  ))}
                </div>

                <aside className="grid content-start gap-3 rounded-[20px] border border-slate-200 bg-white p-4">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Detalle</div>
                    <div className="text-xs text-slate-500">Resumen ampliado del elemento seleccionado.</div>
                  </div>

                  {!selectedRow ? (
                    <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                      Selecciona un cuadro para inspeccionar su contexto operativo.
                    </div>
                  ) : (() => {
                    const e = selectedRow.entity;
                    const nearest = selectedRow.nearest;
                    const tone = statusTone(selectedRow.status);
                    const hasLatestUsage = selectedRow.latestUsage != null;
                    const hasLatestUsageAt = Boolean(selectedRow.latestUsageAt);
                    const cardFields = (e.card_fields ?? []).filter(
                      (f) => String(f.name ?? "").trim() !== "" && String(f.value_text ?? "").trim() !== ""
                    );
                    return (
                      <>
                        <div className="grid gap-2">
                          <div className="rounded-[16px] border p-4" style={{ borderColor: tone.border, background: tone.soft }}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-base font-semibold text-slate-950">{e.name}</div>
                                <div className="mt-1 text-xs text-slate-500">{e.entity_types?.name ?? "Sin tipo"}</div>
                              </div>
                              <Badge variant="outline" className="text-[11px] font-semibold" style={{ borderColor: tone.border, color: tone.strong }}>
                                {selectedRow.hasActiveDeadlines ? nearest?.label ?? "Sin info" : "Sin vencimientos"}
                              </Badge>
                            </div>

                            <div className="mt-4 rounded-[14px] border border-white/70 bg-white/70 px-3 py-2">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Próximo vencimiento</div>
                              <div className="mt-1 text-sm font-medium text-slate-900">
                                {!selectedRow.hasActiveDeadlines
                                  ? "Sin vencimientos activos"
                                  : nearest?.due
                                    ? fmtDate(nearest.due)
                                    : "Sin fecha estimada"}
                              </div>
                              {selectedRow.hasActiveDeadlines ? (
                                <div className="mt-1 text-xs text-slate-500">
                                  {`${nearest?.typeName ?? "Sin tipo"}${
                                    nearest?.measureBy === "usage"
                                      ? " · por uso"
                                      : nearest?.measureBy === "date"
                                        ? " · por fecha"
                                        : ""
                                  }`}
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="rounded-[14px] border border-slate-200 bg-slate-50/70 px-3 py-2">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Uso reciente</div>
                            <div className="mt-1 text-sm font-medium text-slate-900">
                              {hasLatestUsage ? selectedRow.latestUsage : "Sin dato"}
                            </div>
                            {hasLatestUsageAt ? (
                              <div className="mt-1 text-xs text-slate-500">
                                Último registro: {new Date(selectedRow.latestUsageAt as string).toLocaleDateString()}
                              </div>
                            ) : null}
                          </div>
                        </div>

                        {cardFields.length > 0 ? (
                          <div className="grid gap-2">
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Contexto</div>
                            <div className="flex flex-wrap gap-1.5">
                              {cardFields.map((field, idx) => (
                                <Badge key={`${e.id}-${field.name}-${field.value_text}-${idx}`} variant="outline" className="bg-slate-50 text-[11px] font-normal text-slate-600">
                                  {field.name}: {field.value_text}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <Button variant="outline" onClick={() => router.push(`/app/entities/${e.id}`)}>
                          Abrir ficha
                        </Button>
                      </>
                    );
                  })()}
                </aside>
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
