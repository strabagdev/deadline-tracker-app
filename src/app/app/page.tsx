"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

export default function AnalyticsDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [meta, setMeta] = useState<DashboardMeta | null>(null);
  const [q, setQ] = useState("");
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

    const res = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar información analítica.");
      setEntities([]);
      setMeta(null);
      setLoading(false);
      return;
    }

    setEntities((json.entities ?? []) as EntityRow[]);
    setMeta((json.meta ?? null) as DashboardMeta | null);
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
    const needle = q.trim().toLowerCase();
    return entities.filter((e) => {
      if (entityTypeFilter !== "all" && e.entity_type_id !== entityTypeFilter) return false;
      if (!needle) return true;
      return (
        e.name.toLowerCase().includes(needle) ||
        (e.entity_types?.name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [entities, q, entityTypeFilter]);

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
    return arr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 8);
  }, [filtered]);

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
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(0, 12);
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
          <CardContent className="text-sm text-rose-700">{errorMsg}</CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Dashboard</CardTitle>
          <p className="text-sm text-slate-500">Vista analítica para tratamiento de datos, totales, porcentajes y tendencias.</p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-[220px_minmax(220px,1fr)]">
            <select
              value={entityTypeFilter}
              onChange={(e) => setEntityTypeFilter(e.target.value)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">Todos los tipos</option>
              {entityTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar entidad o tipo..." />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Total entidades</div><div className="text-2xl font-semibold">{totals.total}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Con forecast</div><div className="text-2xl font-semibold">{totals.withForecast}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Vencidas</div><div className="text-2xl font-semibold text-rose-700">{totals.overdue}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Al día</div><div className="text-2xl font-semibold text-emerald-700">{totals.healthy}</div></CardContent></Card>
        <Card><CardContent className="pt-4"><div className="text-xs text-slate-500">Cobertura</div><div className="text-2xl font-semibold">{totals.coverage}%</div></CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Distribución por estado</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(["red", "orange", "yellow", "green", "none"] as Status[]).map((s) => {
              const count = countsByStatus[s];
              const pct = filtered.length > 0 ? Math.round((count / filtered.length) * 100) : 0;
              return (
                <div key={s} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>{statusLabel[s]}</span>
                    <span>{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className={`h-2 rounded-full ${statusTone[s]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Top por tipo de entidad</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {byEntityType.length === 0 ? <p className="text-sm text-slate-500">Sin datos para graficar.</p> : null}
            {byEntityType.map((row) => {
              const pct = totals.total > 0 ? Math.round((row.count / totals.total) * 100) : 0;
              return (
                <div key={row.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span className="truncate pr-2">{row.name}</span>
                    <span>{row.count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Tendencia próximos 30 días (vencimientos previstos)</CardTitle></CardHeader>
        <CardContent>
          {dueTrend30.length === 0 ? (
            <p className="text-sm text-slate-500">No hay vencimientos previstos en los próximos 30 días con los filtros actuales.</p>
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
        <CardHeader className="pb-2"><CardTitle className="text-base">Contexto</CardTitle></CardHeader>
        <CardContent className="text-xs text-slate-500">
          Entidades en organización: <b>{meta?.entity_count_in_org ?? entities.length}</b>. Este dashboard es analítico; la operación diaria se mantiene en <b>Operaciones</b>.
        </CardContent>
      </Card>
    </main>
  );
}
