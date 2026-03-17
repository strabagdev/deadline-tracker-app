"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type AlertRow = {
  id: string;
  entity_id: string;
  entity_name?: string;
  deadline_id: string | null;
  deadline_name?: string;
  event_type: string;
  severity: "red" | "orange" | "yellow" | "green" | "none" | string;
  message: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};

type AlertsSummary = {
  active: number;
  resolved_recent: number;
};

type StatusLabels = {
  red: string;
  orange: string;
  yellow: string;
  green: string;
  none: string;
};

function severityClass(level: string) {
  if (level === "red") return "border-rose-300 bg-rose-100 text-rose-800";
  if (level === "orange") return "border-orange-300 bg-orange-100 text-orange-800";
  if (level === "yellow") return "border-amber-300 bg-amber-100 text-amber-800";
  if (level === "green") return "border-emerald-300 bg-emerald-100 text-emerald-800";
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function severityLabel(level: string, labels: StatusLabels) {
  if (level === "red") return labels.red;
  if (level === "orange") return labels.orange;
  if (level === "yellow") return labels.yellow;
  if (level === "green") return labels.green;
  return labels.none;
}

export default function AlertsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [summary, setSummary] = useState<AlertsSummary>({ active: 0, resolved_recent: 0 });
  const [active, setActive] = useState<AlertRow[]>([]);
  const [recentResolved, setRecentResolved] = useState<AlertRow[]>([]);
  const [labels, setLabels] = useState<StatusLabels>({
    red: "Vencido",
    orange: "Por vencer",
    yellow: "Aviso",
    green: "Al día",
    none: "Sin info",
  });

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return null;
    }
    return token;
  }

  async function load() {
    setLoading(true);
    setErrorMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

    const res = await fetch("/api/alert-events", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar el módulo de alertas.");
      setLoading(false);
      return;
    }

    setSummary(json.summary ?? { active: 0, resolved_recent: 0 });
    setActive(Array.isArray(json.active) ? json.active : []);
    setRecentResolved(Array.isArray(json.recent_resolved) ? json.recent_resolved : []);

    const sres = await fetch("/api/settings/semaphore", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sjson = await sres.json().catch(() => ({}));
    if (sres.ok && sjson?.settings) {
      setLabels({
        red: String(sjson.settings.label_red ?? "Vencido"),
        orange: String(sjson.settings.label_orange ?? "Por vencer"),
        yellow: String(sjson.settings.label_yellow ?? "Aviso"),
        green: String(sjson.settings.label_green ?? "Al día"),
        none: "Sin info",
      });
    }

    setLoading(false);
  }

  async function recompute() {
    setBusy(true);
    setErrorMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/alert-events", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo recomputar alertas.");
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePreview = useMemo(() => active.slice(0, 100), [active]);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Eventos</CardTitle>
              <p className="mt-1 text-sm text-slate-500">
                Historial operativo derivado desde <code>deadline_forecasts</code>. El estado vigente se revisa en Forecast.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app/forecast">
                <Button variant="outline" size="sm">Ir a Forecast</Button>
              </Link>
              <Button onClick={() => void recompute()} disabled={busy} size="sm">
                {busy ? "Actualizando..." : "Actualizar eventos"}
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-2 py-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between">
          <div>
            <b className="text-slate-800">Forecast</b> es la fuente de verdad del estado actual.
          </div>
          <div>
            <b className="text-slate-800">Eventos</b> conserva trazabilidad de entradas y salidas de riesgo.
          </div>
        </CardContent>
      </Card>

      {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}

      {loading ? (
        <div className="flex min-h-[60vh] items-center justify-center py-8">
          <Loader label="Cargando alertas..." />
        </div>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Eventos activos</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.active}</div></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Eventos cerrados recientes</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-semibold">{summary.resolved_recent}</div></CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Riesgos activos registrados</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {activePreview.length === 0 ? (
                <p className="text-sm text-slate-500">Sin eventos activos.</p>
              ) : (
                <div className="space-y-2">
                  {activePreview.map((a) => (
                    <div key={a.id} className="rounded-xl border bg-slate-50 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={severityClass(a.severity)}>
                          {severityLabel(a.severity, labels)}
                        </Badge>
                        <Badge variant="outline">{a.entity_name ?? "Entidad"}</Badge>
                        <Badge variant="outline">{a.deadline_name ?? "Vencimiento"}</Badge>
                        <span className="text-xs text-slate-500">Última detección: {new Date(a.last_seen_at).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{a.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Historial reciente</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {recentResolved.length === 0 ? (
                <p className="text-sm text-slate-500">Sin eventos cerrados recientes.</p>
              ) : (
                <div className="space-y-1.5">
                  {recentResolved.map((a) => (
                    <div key={a.id} className="rounded-lg border bg-white px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={severityClass(a.severity)}>
                          {severityLabel(a.severity, labels)}
                        </Badge>
                        <span className="text-slate-700">{a.message}</span>
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
