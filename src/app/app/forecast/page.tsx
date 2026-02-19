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
  active_alerts: number;
  total_forecasts: number;
};

type ForecastEntity = {
  entity_id: string;
  entity_name: string;
  deadline_id: string;
  deadline_name: string;
  forecast_due_date: string | null;
  days_remaining: number | null;
  risk_level: "green" | "yellow" | "red";
  risk_score: number;
};

type ForecastAlert = {
  id: string;
  entity_id: string;
  deadline_id: string | null;
  type: string;
  severity: string;
  message: string;
  created_at: string;
};

function riskBadgeClass(level: string) {
  if (level === "red") return "border-rose-300 bg-rose-100 text-rose-800";
  if (level === "yellow") return "border-amber-300 bg-amber-100 text-amber-800";
  return "border-emerald-300 bg-emerald-100 text-emerald-800";
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString();
}

export default function ForecastPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [summary, setSummary] = useState<ForecastSummary>({
    upcoming_7_days: 0,
    upcoming_30_days: 0,
    active_alerts: 0,
    total_forecasts: 0,
  });
  const [rows, setRows] = useState<ForecastEntity[]>([]);
  const [alerts, setAlerts] = useState<ForecastAlert[]>([]);
  const [computedAt, setComputedAt] = useState<string>("");

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
      setLoading(false);
      return;
    }

    setSummary(json.summary ?? summary);
    setRows(Array.isArray(json.entities) ? json.entities : []);
    setAlerts(Array.isArray(json.alerts) ? json.alerts : []);
    setComputedAt(String(json.computed_at ?? ""));
    setBusy(false);
    setLoading(false);
  }

  useEffect(() => {
    void recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alertPreview = useMemo(() => alerts.slice(0, 10), [alerts]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>OpsAhead Forecast</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Proyección de vencimientos, riesgo y alertas automáticas.</p>
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
          <section className="grid gap-3 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos 7 días</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.upcoming_7_days}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Próximos 30 días</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.upcoming_30_days}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Alertas activas</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.active_alerts}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Forecasts</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.total_forecasts}</div></CardContent>
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
                  <div className="grid min-w-[760px] grid-cols-[1.4fr_1.1fr_0.9fr_0.9fr_0.8fr] border-b bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                    <div>Entidad</div>
                    <div>Próximo vencimiento</div>
                    <div>Fecha estimada</div>
                    <div>Días restantes</div>
                    <div>Riesgo</div>
                  </div>
                  {rows.map((r) => (
                    <div key={`${r.entity_id}-${r.deadline_id}`} className="grid min-w-[760px] grid-cols-[1.4fr_1.1fr_0.9fr_0.9fr_0.8fr] items-center border-b px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <Link href={`/app/entities/${r.entity_id}`} className="truncate font-semibold text-slate-900 hover:underline">
                          {r.entity_name}
                        </Link>
                      </div>
                      <div className="truncate text-slate-700">{r.deadline_name}</div>
                      <div className="text-slate-700">{fmtDate(r.forecast_due_date)}</div>
                      <div className="text-slate-700">{r.days_remaining ?? "—"}</div>
                      <div>
                        <Badge variant="outline" className={riskBadgeClass(r.risk_level)}>
                          {r.risk_level}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Alertas activas</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {alertPreview.length === 0 ? (
                <p className="text-sm text-slate-500">Sin alertas activas.</p>
              ) : (
                <div className="space-y-2">
                  {alertPreview.map((a) => (
                    <div key={a.id} className="rounded-xl border bg-slate-50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{a.type}</Badge>
                        <Badge variant="outline" className={riskBadgeClass(a.severity)}>{a.severity}</Badge>
                        <span className="text-xs text-slate-500">{new Date(a.created_at).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{a.message}</p>
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

