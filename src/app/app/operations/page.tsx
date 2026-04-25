"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconArrowUp, IconChevronDown, IconRotateClockwise } from "@tabler/icons-react";
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

type IconProps = {
  className?: string;
};

type FilterDropdownOption = {
  value: string;
  label: string;
  count?: number;
  badgeClassName?: string;
};

const CARD_PAGE_SIZE = 200;

function IconClearFilters({ className }: IconProps) {
  return <IconRotateClockwise stroke={2} className={cn("h-5 w-5", className)} aria-hidden />;
}

function InlineSpinner({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-sky-200 animate-pulse [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-sky-300 animate-pulse [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse [animation-delay:300ms]" />
    </span>
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

function statusBadgeClasses(s: Status | "all") {
  if (s === "all") return "border-slate-300 bg-slate-100 text-slate-700";
  return statusFilterPalette(s);
}

function entityTypeBadgeClasses(active: boolean) {
  return active
    ? "border-violet-200 bg-violet-50 text-violet-700"
    : "border-slate-200 bg-slate-50 text-slate-600";
}

function FilterDropdown({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: FilterDropdownOption[];
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const isDefault = value === "all";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex min-h-[var(--control-h)] min-w-[170px] items-center justify-between gap-2 rounded-[1.2rem] px-3.5 text-left text-stone-50 transition",
          isDefault ? "bg-transparent hover:bg-white/5" : "bg-stone-900 hover:bg-stone-800"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <span className={cn("block truncate text-base font-semibold", isDefault ? "text-stone-50" : "text-stone-50")}>
            {isDefault ? label : selected.label}
          </span>
        </div>
        <IconChevronDown className={cn("h-4 w-4 shrink-0 text-stone-300 transition-transform", open && "rotate-180")} stroke={2} aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-30 w-full min-w-[250px] rounded-[1.25rem] border border-stone-700 bg-stone-950 p-2 shadow-[0_18px_38px_-24px_rgba(42,26,8,0.45)]">
          <div role="listbox" aria-label={label} className="grid gap-1">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onSelect(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors",
                    active ? "bg-stone-800" : "hover:bg-stone-900"
                  )}
                >
                  <span className={cn("inline-flex min-w-0 items-center gap-2 rounded-full border px-2 py-0.5 text-[11px] font-medium", option.badgeClassName)}>
                    <span className="truncate">{option.label}</span>
                  </span>
                  {option.count != null ? <span className="shrink-0 text-[11px] text-stone-400">{option.count}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function OperationsPage() {
  const router = useRouter();
  const operationsPanelRef = useRef<HTMLDivElement | null>(null);
  const filtersBarRef = useRef<HTMLDivElement | null>(null);
  const secondaryDropdownRef = useRef<HTMLDivElement | null>(null);

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [meta, setMeta] = useState<DashboardMeta | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterSecondary, setFilterSecondary] = useState<string[]>([]);
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [filtersCollapsed, setFiltersCollapsed] = useState(true);
  const [secondaryDropdownOpen, setSecondaryDropdownOpen] = useState(false);

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
      view_mode: "cards",
      page: String(page),
      page_size: String(CARD_PAGE_SIZE),
    });
    if (filterStatus !== "all") params.set("status", filterStatus);
    if (filterEntityType !== "all") params.set("entity_type_id", filterEntityType);
    if (filterSecondary.length > 0) params.set("secondary", filterSecondary.join(","));
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
  }, [filterEntityType, filterSecondary, filterStatus, page, q, router]);

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

  useEffect(() => {
    if (!selectedEntityId) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!operationsPanelRef.current?.contains(event.target as Node)) {
        setSelectedEntityId("");
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [selectedEntityId]);

  useEffect(() => {
    if (!secondaryDropdownOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!secondaryDropdownRef.current?.contains(event.target as Node)) {
        setSecondaryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [secondaryDropdownOpen]);

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
  const effectivePageSize = Number(meta?.page_size ?? CARD_PAGE_SIZE);
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
    q.trim().length > 0 || filterEntityType !== "all" || filterStatus !== "all" || filterSecondary.length > 0;

  const countByStatus = useCallback((s: Status | "all") => {
    if (s === "all") return statusCounts.total;
    if (s === "red") return statusCounts.red;
    if (s === "orange") return statusCounts.orange;
    if (s === "yellow") return statusCounts.yellow;
    if (s === "green") return statusCounts.green;
    return statusCounts.none;
  }, [statusCounts]);

  const statusFilterOptions = useMemo<FilterDropdownOption[]>(
    () =>
      statusFilterMeta.map((item) => ({
        value: item.key,
        label: item.title,
        count: countByStatus(item.key),
        badgeClassName: statusBadgeClasses(item.key),
      })),
    [countByStatus, statusFilterMeta]
  );

  const selectedSecondaryOptions = useMemo(
    () => secondaryFilterOptions.filter((option) => filterSecondary.includes(option.value)),
    [filterSecondary, secondaryFilterOptions]
  );

  const entityTypeDropdownOptions = useMemo<FilterDropdownOption[]>(
    () => [
      {
        value: "all",
        label: "Todos",
        badgeClassName: entityTypeBadgeClasses(filterEntityType === "all"),
      },
      ...entityTypeOptions.map((option) => ({
        value: option.id,
        label: option.name,
        badgeClassName: entityTypeBadgeClasses(filterEntityType === option.id),
      })),
    ],
    [entityTypeOptions, filterEntityType]
  );

  const filtersSummary = useMemo(() => {
    const selectedType = entityTypeDropdownOptions.find((option) => option.value === filterEntityType);
    const selectedStatus = statusFilterOptions.find((option) => option.value === filterStatus);
    const clauses: string[] = [];

    if (filterEntityType !== "all" && selectedType) clauses.push(`del tipo ${selectedType.label}`);
    if (filterStatus !== "all" && selectedStatus) clauses.push(`en estado ${selectedStatus.label.toLowerCase()}`);
    if (filterSecondary.length > 0) {
      clauses.push(
        `con ${filterSecondary.slice(0, 2).join(", ")}${filterSecondary.length > 2 ? ` y ${filterSecondary.length - 2} más` : ""}`
      );
    }
    if (q.trim()) clauses.push(`que coinciden con "${q.trim()}"`);

    if (clauses.length === 0) return "Mostrando todas las entidades";
    return `Se están mostrando entidades ${clauses.join(" ")}`;
  }, [entityTypeDropdownOptions, filterEntityType, filterSecondary, filterStatus, q, statusFilterOptions]);

  function scrollToFilters() {
    const element = filtersBarRef.current;
    if (!element) return;
    const stickyTop = 96;
    const absoluteTop = window.scrollY + element.getBoundingClientRect().top;
    window.scrollTo({
      top: Math.max(0, absoluteTop - stickyTop),
      behavior: "smooth",
    });
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <PageHero
        badge="Operación"
        secondaryBadge="Seguimiento"
        title="Operaciones"
        subtitle="Control visual del estado operativo y acceso directo al detalle por entidad."
        density="compact"
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={scrollToFilters}
            title="Ir a filtros"
            aria-label="Ir a filtros"
            className="h-10 w-10 rounded-full"
          >
            <IconArrowUp className="h-4 w-4" stroke={2} />
          </Button>
        }
      />

      <div ref={filtersBarRef} className="sticky top-24 z-20 rounded-[2rem] border border-stone-200 bg-stone-950 px-6 py-6 text-stone-50 shadow-[0_20px_45px_rgba(42,26,8,0.35)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-400">Filtros</div>
            <div className="mt-1 text-sm font-semibold text-stone-50">
              {hasActiveFilters ? filtersSummary : "Mostrando todas las entidades"}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFiltersCollapsed((current) => !current)}
            className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-3 py-2 text-sm font-medium text-stone-100 transition hover:bg-stone-800"
            aria-expanded={!filtersCollapsed}
            aria-label={filtersCollapsed ? "Expandir filtros" : "Colapsar filtros"}
          >
            <span>{filtersCollapsed ? "Mostrar" : "Ocultar"}</span>
            <IconChevronDown className={cn("h-4 w-4 transition-transform", filtersCollapsed && "rotate-180")} stroke={2} aria-hidden />
          </button>
        </div>
        {!filtersCollapsed ? (
          <>
            <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
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
                    className="w-full border-0 bg-transparent text-xl font-semibold text-stone-50 placeholder:text-lg placeholder:font-semibold placeholder:text-stone-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <FilterDropdown
                    label="Tipo"
                    value={filterEntityType}
                    options={entityTypeDropdownOptions}
                    onSelect={(value) => {
                      setFilterEntityType(value);
                      setPage(1);
                    }}
                  />

                  <FilterDropdown
                    label="Estado"
                    value={filterStatus}
                    options={statusFilterOptions}
                    onSelect={(value) => {
                      setFilterStatus(value as Status | "all");
                      setPage(1);
                    }}
                  />
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setQ("");
                    setFilterEntityType("all");
                    setFilterStatus("all");
                    setFilterSecondary([]);
                    setPage(1);
                  }}
                  disabled={!hasActiveFilters}
                  className="min-h-[var(--control-h)] min-w-[var(--control-h)] shrink-0 border-0 bg-transparent px-0 text-stone-50 hover:bg-white/5 hover:text-stone-50"
                  title="Limpiar filtros"
                  aria-label="Limpiar filtros"
                >
                  <IconClearFilters />
                </Button>
              </div>
            </div>
            {secondaryFilterOptions.length > 0 ? (
              <div className="mt-4 rounded-[1.35rem] bg-stone-900/80 px-4 py-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">Filtro secundario</div>
                      <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-stone-50">
                        {filterSecondary.length > 0
                          ? `${filterSecondary.length} seleccion${filterSecondary.length === 1 ? "" : "es"}`
                          : "Selecciona una o varias opciones"}
                        {loading ? <InlineSpinner /> : null}
                      </div>
                    </div>
                  </div>

                  <div ref={secondaryDropdownRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setSecondaryDropdownOpen((current) => !current)}
                      className="flex min-h-[88px] w-full items-start justify-between gap-3 rounded-[1.35rem] border border-stone-700 bg-stone-950 px-4 py-3 text-left transition hover:bg-stone-900"
                      aria-haspopup="listbox"
                      aria-expanded={secondaryDropdownOpen}
                    >
                      <div className="min-w-0 flex-1">
                        {selectedSecondaryOptions.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {selectedSecondaryOptions.map((option) => (
                              <span
                                key={`secondary-selected-${option.value}`}
                                className="inline-flex max-w-full items-center gap-2 rounded-full border border-sky-300/20 bg-sky-400/15 px-3 py-1.5 text-xs font-medium text-sky-200"
                              >
                                <span className="truncate">{option.value}</span>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setFilterSecondary((current) => current.filter((value) => value !== option.value));
                                    setPage(1);
                                  }}
                                  className="text-sm leading-none text-sky-100 transition hover:text-white"
                                  aria-label={`Quitar ${option.value}`}
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="pt-1 text-sm font-medium text-stone-400">
                            Haz clic para desplegar opciones y seleccionar varias
                          </div>
                        )}
                      </div>
                      <IconChevronDown
                        className={cn("mt-1 h-5 w-5 shrink-0 text-stone-400 transition-transform", secondaryDropdownOpen && "rotate-180")}
                        stroke={2}
                        aria-hidden
                      />
                    </button>

                    {secondaryDropdownOpen ? (
                      <div className="absolute left-0 top-[calc(100%+10px)] z-30 w-full rounded-[1.35rem] border border-stone-700 bg-stone-950 p-3 shadow-[0_18px_38px_-24px_rgba(42,26,8,0.45)]">
                        <div role="listbox" aria-label="Filtro secundario" className="flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
                          {secondaryFilterOptions.filter((option) => !filterSecondary.includes(option.value)).length > 0 ? (
                            secondaryFilterOptions
                              .filter((option) => !filterSecondary.includes(option.value))
                              .map((option) => (
                                <button
                                  key={`secondary-option-${option.value}`}
                                  type="button"
                                  onClick={() => {
                                    setFilterSecondary((current) => [...current, option.value]);
                                    setPage(1);
                                  }}
                                  className="inline-flex items-center gap-2 rounded-full border border-stone-700 bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-200 transition hover:bg-stone-800"
                                >
                                  <span className="truncate">{option.value}</span>
                                  <span className="text-[11px] text-stone-400">{option.count}</span>
                                </button>
                              ))
                          ) : (
                            <div className="w-full rounded-[1rem] border border-dashed border-stone-700 px-4 py-3 text-sm text-stone-400">
                              No hay más opciones secundarias disponibles.
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
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
          <div ref={operationsPanelRef} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-3">
                  {groupedPagedRows.map(([typeName, typeRows]) => (
                    <section key={typeName} className="space-y-2">
                      <div className="rounded-[18px] border border-slate-200 bg-white p-3">
                        <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-100 pb-2">
                          <div className="text-xs font-semibold text-[var(--muted-foreground)]">{typeName}</div>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{typeRows.length}</span>
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(24px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(28px,1fr))]">
                          {typeRows.map((r) => {
                            const e = r.entity;
                            const nearest = r.nearest;
                            const selected = effectiveSelectedEntityId === e.id;
                            const palette = statusFilterPalette(r.status);
                            const tone = statusTone(r.status);
                            const typeLabel = e.entity_types?.name ?? "Sin tipo";
                            const statusLabel = nearest?.label ?? "Sin info";
                            const dueLabel = !r.hasActiveDeadlines
                              ? "Sin vencimientos"
                              : nearest?.due
                                ? fmtDate(nearest.due)
                                : "Sin fecha estimada";
                            return (
                              <div key={e.id} className="group relative">
                                <button
                                  type="button"
                                  onClick={() => setSelectedEntityId(e.id)}
                                  className={cn(
                                    "aspect-square min-h-6 rounded-[7px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] transition hover:-translate-y-0.5 hover:scale-[1.08] hover:shadow-[0_6px_14px_-10px_rgba(15,23,42,0.55)] focus-visible:-translate-y-0.5 focus-visible:scale-[1.08] focus-visible:shadow-[0_6px_14px_-10px_rgba(15,23,42,0.55)]",
                                    palette,
                                    selected && "ring-2 ring-sky-300 ring-offset-1 shadow-[0_0_0_1px_rgba(125,211,252,0.2)]"
                                  )}
                                  aria-label={`${e.name}, ${typeLabel}, ${statusLabel}, ${dueLabel}`}
                                />
                                <div
                                  className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 hidden w-56 -translate-x-1/2 rounded-[14px] px-3 py-2 text-left shadow-[0_16px_36px_-20px_rgba(15,23,42,0.45)] backdrop-blur group-hover:block group-focus-within:block"
                                  style={{ border: `1px solid ${tone.border}`, background: tone.soft }}
                                >
                                  <div className="truncate text-sm font-semibold text-slate-900">{e.name}</div>
                                  <div className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">{typeLabel}</div>
                                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                                    <span
                                      className="rounded-full px-2 py-0.5 font-medium"
                                      style={{ background: "#ffffffb3", color: tone.strong }}
                                    >
                                      {statusLabel}
                                    </span>
                                    <span className="text-slate-500">{dueLabel}</span>
                                  </div>
                                  <div
                                    className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 rotate-45"
                                    style={{ borderBottom: `1px solid ${tone.border}`, borderRight: `1px solid ${tone.border}`, background: tone.soft }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </section>
                  ))}

                  <div className="rounded-[18px] border border-slate-200 bg-white px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px]">
                        {statusFilterMeta.filter((item) => item.key !== "all").map((item) => {
                          return (
                            <div key={`legend-inline-${item.key}`} className="inline-flex items-center gap-2 text-slate-600">
                              <span className={cn("h-3 w-3 rounded-[4px] border", statusLegendSwatch(item.key as Status))} />
                              {item.title}
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2 text-right">
                        <div className="text-[11px] text-slate-500">
                          Mostrando {totalRowsForPagination === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + effectivePageSize, totalRowsForPagination)} de {totalRowsForPagination}
                        </div>
                        {totalPages > 1 ? (
                          <div className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 p-1">
                            <Button
                              onClick={() => setPage((p) => Math.max(1, p - 1))}
                              disabled={safePage <= 1}
                              variant="outline"
                              size="sm"
                              className="h-7 min-w-7 rounded-full px-0 text-[11px]"
                              title="Página anterior"
                              aria-label="Página anterior"
                            >
                              ◀
                            </Button>
                            <div className="px-1 text-[11px] font-medium text-slate-600">
                              {safePage}/{totalPages}
                            </div>
                            <Button
                              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                              disabled={safePage >= totalPages}
                              variant="outline"
                              size="sm"
                              className="h-7 min-w-7 rounded-full px-0 text-[11px]"
                              title="Página siguiente"
                              aria-label="Página siguiente"
                            >
                              ▶
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
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
                                <div className="truncate text-base font-semibold leading-6 text-slate-950">{e.name}</div>
                                <div className="mt-1 break-words text-xs text-slate-500">{e.entity_types?.name ?? "Sin tipo"}</div>
                              </div>
                              <Badge
                                variant="outline"
                                className="max-w-[11rem] shrink-0 whitespace-normal break-words text-[11px] font-semibold leading-4 text-center"
                                style={{ borderColor: tone.border, color: tone.strong }}
                              >
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

                        <Button variant="secondary" onClick={() => router.push(`/app/entities/${e.id}`)}>
                          Abrir ficha
                        </Button>
                      </>
                    );
                  })()}
                </aside>
              </div>
        )}
      </section>
    </main>
  );
}
