"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ForecastSummary = {
  upcoming_7_days: number;
  upcoming_30_days: number;
  total_forecasts: number;
  total_entities?: number;
};

type ForecastEntity = {
  entity_id: string;
  entity_name: string;
  deadline_id: string;
  deadline_name: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: "green" | "yellow" | "orange" | "red" | "none";
  risk_score: number;
};

type Status = "red" | "orange" | "yellow" | "green" | "none";

function riskBadgeClass(level: string) {
  if (level === "red") return "border-rose-300 bg-rose-100 text-rose-800";
  if (level === "orange") return "border-orange-300 bg-orange-100 text-orange-800";
  if (level === "yellow") return "border-amber-300 bg-amber-100 text-amber-800";
  if (level === "none") return "border-slate-300 bg-slate-100 text-slate-700";
  return "border-emerald-300 bg-emerald-100 text-emerald-800";
}

function statusLabel(level: string) {
  if (level === "red") return "Vencido";
  if (level === "orange") return "Urgente";
  if (level === "yellow") return "Por vencer";
  if (level === "green") return "Al día";
  if (level === "none") return "Sin info";
  return level;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}

function statusPriority(s: Status) {
  if (s === "red") return 0;
  if (s === "orange") return 1;
  if (s === "yellow") return 2;
  if (s === "green") return 3;
  return 4;
}

export default function ForecastPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [summary, setSummary] = useState<ForecastSummary>({
    upcoming_7_days: 0,
    upcoming_30_days: 0,
    total_forecasts: 0,
    total_entities: 0,
  });
  const [rows, setRows] = useState<ForecastEntity[]>([]);
  const [computedAt, setComputedAt] = useState<string>("");

  async function loadForecasts() {
    setLoading(true);
    setErrorMsg("");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/forecasts", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar forecast");
      setLoading(false);
      return;
    }

    setSummary(json.summary ?? summary);
    setRows(Array.isArray(json.entities) ? json.entities : []);
    setComputedAt(String(json.computed_at ?? ""));
    setLoading(false);
  }

  async function recompute() {
    setBusy(true);
    setErrorMsg("");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return;
    }

    const res = await fetch("/api/forecasts/recompute", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo recomputar forecast");
      setBusy(false);
      return;
    }

    await loadForecasts();
    setBusy(false);
  }

  useEffect(() => {
    void loadForecasts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const orderedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const pa = statusPriority(a.risk_level);
      const pb = statusPriority(b.risk_level);
      if (pa !== pb) return pa - pb;
      const da = a.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const db = b.days_remaining ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return a.entity_name.localeCompare(b.entity_name);
    });
  }, [rows]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>OpsAhead Forecast</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Proyección de vencimientos, estado y alertas automáticas.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <Button onClick={() => void recompute()} disabled={busy} size="sm">
                {busy ? "Recomputando..." : "Recomputar"}
              </Button>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            {computedAt ? `Último cálculo: ${new Date(computedAt).toLocaleString()}` : "Sin cálculo reciente"}
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader label="Calculando pronósticos..." />
        </div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos 7 días</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.upcoming_7_days}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos 30 días</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.upcoming_30_days}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Entidades</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.total_entities ?? rows.length}</div></CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Por entidad</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {rows.length === 0 ? (
                <p className="text-sm text-slate-500">No hay datos de forecast para mostrar.</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border">
                  <div className="grid min-w-[860px] grid-cols-[1.35fr_1.05fr_0.9fr_0.85fr_0.7fr_0.65fr] border-b bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    <div>Entidad</div>
                    <div>Próximo vencimiento</div>
                    <div>Fecha estimada</div>
                    <div>Días restantes</div>
                    <div>Puntaje</div>
                    <div>Estado</div>
                  </div>
                  {orderedRows.map((r) => (
                    <div key={`${r.entity_id}-${r.deadline_id}`} className="grid min-w-[860px] grid-cols-[1.35fr_1.05fr_0.9fr_0.85fr_0.7fr_0.65fr] items-center border-b px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <Link href={`/app/entities/${r.entity_id}`} className="truncate font-semibold text-slate-900 hover:underline">
                          {r.entity_name}
                        </Link>
                      </div>
                      <div className="truncate text-slate-700">{r.deadline_name}</div>
                      <div className="text-slate-700">{r.forecast_due_date ? fmtDate(r.forecast_due_date) : "Sin fecha estimada"}</div>
                      <div className="text-slate-700">{r.days_remaining ?? "Sin info"}</div>
                      <div className="text-slate-700">{Math.round(Number(r.risk_score ?? 0))}</div>
                      <div>
                        <Badge variant="outline" className={riskBadgeClass(r.risk_level)}>
                          {statusLabel(r.risk_level)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </>
      )}
    </main>
  );
}
