"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { pickNearestDeadline } from "@/lib/deadlines/calculateDeadlineStatus";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type DeadlineType = {
  id: string;
  name: string;
  measure_by: "date" | "usage";
  requires_document: boolean;
  is_active: boolean;
};

type Deadline = {
  id: string;
  deadline_type_id: string;
  last_done_date: string | null;
  next_due_date: string | null;
  last_done_usage: number | null;
  frequency: number | null;
  frequency_unit: string | null;
  usage_daily_average: number | null;
  created_at: string;
  deadline_types?: DeadlineType | null;
};

type EntityType = { id: string; name: string };

type EntityRow = {
  id: string;
  name: string;
  created_at: string;
  entity_type_id: string;
  entity_types?: EntityType | null;
  deadlines?: Deadline[] | null;
};

type LatestUsageByEntity = Record<string, { value: number; logged_at: string }>;

type DashboardMeta = {
  active_org_id: string;
  role: string;
  entity_count_in_org: number;
};

type Status = "red" | "orange" | "yellow" | "green" | "none";

type SemaphoreSettings = {
  yellow_days: number;
  orange_days: number;
  red_days: number;
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

const statusFilterMeta: Array<{ key: Status | "all"; title: string }> = [
  { key: "all", title: "Todos" },
  { key: "red", title: "Vencido" },
  { key: "orange", title: "Urgente" },
  { key: "yellow", title: "Por vencer" },
  { key: "green", title: "Al día" },
  { key: "none", title: "Sin info" },
];

export default function AppDashboard() {
  const router = useRouter();

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [meta, setMeta] = useState<DashboardMeta | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewMode, setViewMode] = useState<ViewMode>("cards");
  const [dashboardPanelCollapsed, setDashboardPanelCollapsed] = useState(true);

  const [semaphore, setSemaphore] = useState<SemaphoreSettings>({
    yellow_days: 60,
    orange_days: 30,
    red_days: 15,
  });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => {
      void load();
    };
    window.addEventListener("dashboard-refresh", handler);
    return () => window.removeEventListener("dashboard-refresh", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setErrorMsg("");

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar el dashboard");
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
      });
    }

    setLoading(false);
  }

  const entityTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) {
      const t = e.entity_types;
      if (t?.id) map.set(t.id, t.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entities]);

  const computedAll = useMemo(() => {
    return entities.map((e) => {
      const latest = usage[e.id]?.value ?? null;
      const latestAt = usage[e.id]?.logged_at ?? null;
      const hasActiveDeadlines = (e.deadlines ?? []).some((d) => d.deadline_types?.is_active !== false);
      const nearest = pickNearestDeadline(e.deadlines, latest, {
        yellowDays: Number(semaphore.yellow_days ?? 60),
        orangeDays: Number(semaphore.orange_days ?? 30),
        redDays: Number(semaphore.red_days ?? 15),
      });
      const status: Status = (nearest?.status as Status) ?? "none";
      return { entity: e, latestUsage: latest, latestUsageAt: latestAt, nearest, status, hasActiveDeadlines };
    });
  }, [entities, usage, semaphore]);

  const countsAll = useMemo(() => {
    let red = 0,
      orange = 0,
      yellow = 0,
      green = 0,
      none = 0;

    for (const r of computedAll) {
      if (r.status === "red") red++;
      else if (r.status === "orange") orange++;
      else if (r.status === "yellow") yellow++;
      else if (r.status === "green") green++;
      else none++;
    }

    return { red, orange, yellow, green, none, total: computedAll.length };
  }, [computedAll]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = computedAll.filter((r) => {
      if (filterEntityType !== "all" && r.entity.entity_type_id !== filterEntityType) return false;
      if (filterStatus !== "all" && r.status !== filterStatus) return false;
      if (needle) {
        const name = r.entity.name.toLowerCase();
        const typeName = (r.entity.entity_types?.name ?? "").toLowerCase();
        const nearestName = (r.nearest?.typeName ?? "").toLowerCase();
        if (!name.includes(needle) && !typeName.includes(needle) && !nearestName.includes(needle)) return false;
      }
      return true;
    });

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
  }, [computedAll, filterEntityType, filterStatus, q]);

  useEffect(() => {
    setPage(1);
  }, [filterEntityType, filterStatus, q, pageSize]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(pageStart, pageStart + pageSize);

  const hasEntities = (meta?.entity_count_in_org ?? entities.length) > 0;
  const hasActiveFilters = q.trim().length > 0 || filterEntityType !== "all" || filterStatus !== "all";

  function countByStatus(s: Status | "all") {
    if (s === "all") return countsAll.total;
    if (s === "red") return countsAll.red;
    if (s === "orange") return countsAll.orange;
    if (s === "yellow") return countsAll.yellow;
    if (s === "green") return countsAll.green;
    return countsAll.none;
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

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CardTitle className="shrink-0">Dashboard</CardTitle>
            <div className="min-w-0 flex-1 overflow-x-auto pl-8 md:pl-16">
              <div className="flex w-max items-center gap-2 pr-2">
                {statusFilterMeta.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant="outline"
                    onClick={() => setFilterStatus(s.key)}
                    className={statusChipClasses(s.key, filterStatus === s.key)}
                    title={s.title}
                  >
                    <IconStatus status={s.key} />
                    {filterStatus === s.key ? <span>✓</span> : null}
                    <span>{s.title}</span>
                    <span className="font-semibold">{countByStatus(s.key)}</span>
                  </Button>
                ))}
                <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
                <Button
                  size="sm"
                  variant={viewMode === "cards" ? "secondary" : "outline"}
                  onClick={() => setViewMode("cards")}
                >
                  <IconGrid />
                  Tarjetas
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "list" ? "secondary" : "outline"}
                  onClick={() => setViewMode("list")}
                >
                  <IconList />
                  Lista
                </Button>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDashboardPanelCollapsed((v) => !v)}
              className="min-w-[110px] shrink-0 justify-between"
            >
              <span>{dashboardPanelCollapsed ? "Buscar" : "Ocultar"}</span>
              <span className="text-xs">{dashboardPanelCollapsed ? "▼" : "▲"}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="py-3">
          {!dashboardPanelCollapsed ? (
            <div className="mt-3 rounded-xl border bg-slate-50/80 px-3 py-2">
              <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:flex-nowrap">
                <Input
                  id="dashboard_search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por nombre, tipo o vencimiento..."
                  className="min-w-[240px] flex-1"
                />
                <select
                  id="dashboard_type"
                  aria-label="Filtrar por tipo"
                  value={filterEntityType}
                  onChange={(e) => setFilterEntityType(e.target.value)}
                  className="h-10 min-w-[180px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="all">Todos los tipos</option>
                  {entityTypeOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <select
                  id="dashboard_page_size"
                  aria-label="Filas por página"
                  value={String(pageSize)}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="h-10 min-w-[150px] rounded-xl border border-slate-300 bg-white px-3 text-sm"
                >
                  <option value="25">25 / página</option>
                  <option value="50">50 / página</option>
                  <option value="100">100 / página</option>
                </select>
                <Button
                  variant="outline"
                  className="h-10 min-w-[140px]"
                  onClick={() => {
                    setQ("");
                    setFilterEntityType("all");
                    setFilterStatus("all");
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

      {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}

      <section className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader label="Cargando dashboard..." />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              {!hasEntities ? (
                <p className="text-sm text-slate-600">Aún no hay entidades. Crea tu primera entidad para comenzar.</p>
              ) : (
                <p className="text-sm text-slate-600">No hay entidades para mostrar con estos filtros.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <>
            {viewMode === "cards" ? (
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                {pagedRows.map((r) => {
                  const e = r.entity;
                  const nearest = r.nearest;
                  const tone = statusTone(r.status);
                  const hasLatestUsage = r.latestUsage != null;
                  const hasLatestUsageAt = Boolean(r.latestUsageAt);
                  const dueLabel = !r.hasActiveDeadlines
                    ? "Sin vencimientos"
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
                      className="grid min-h-[112px] cursor-pointer content-between gap-1.5 rounded-2xl border p-2.5 shadow-sm transition-shadow hover:shadow-md"
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
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="bg-white text-[10px] font-medium text-slate-600">
                          {!r.hasActiveDeadlines
                            ? "Sin vencimiento asignado"
                            : `${nearest?.typeName ?? "Sin tipo"}${
                                nearest?.measureBy === "usage"
                                  ? " · uso"
                                  : nearest?.measureBy === "date"
                                    ? " · fecha"
                                    : ""
                              }`}
                        </Badge>
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
            ) : (
              <div className="overflow-x-auto rounded-2xl border bg-white">
                <div className="grid grid-cols-[1.3fr_0.95fr_1.55fr_0.8fr] border-b bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                  <div>Entidad</div>
                  <div>Estado</div>
                  <div>Próximo vencimiento</div>
                  <div className="text-right">Uso</div>
                </div>
                {pagedRows.map((r) => {
                  const e = r.entity;
                  const nearest = r.nearest;
                  const tone = statusTone(r.status);
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
                            ? "Sin vencimientos"
                            : nearest?.due
                              ? fmtDate(nearest.due)
                              : "Sin fecha estimada"}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {!r.hasActiveDeadlines
                            ? "Asocia un vencimiento"
                            : `${nearest?.typeName ?? "Sin tipo"}${
                                nearest?.measureBy === "usage"
                                  ? " · por uso"
                                  : nearest?.measureBy === "date"
                                    ? " · por fecha"
                                    : ""
                              }`}
                        </div>
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
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2">
              <div className="text-xs text-slate-500">
                Mostrando {rows.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + pageSize, rows.length)} de {rows.length}
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  variant="outline"
                  size="sm"
                  className="h-8 min-w-8 px-2"
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
                  className="h-8 min-w-8 px-2"
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
