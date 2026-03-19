"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";

type DatasetOption = { key: string; label: string };
type EndpointRow = {
  id: string;
  slug: string;
  label: string;
  dataset_key: string;
  endpoint_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function baseUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export default function BiIntegrationsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [datasets, setDatasets] = useState<DatasetOption[]>([]);
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);

  const [newLabel, setNewLabel] = useState("");
  const [newDatasetKey, setNewDatasetKey] = useState("");

  const datasetLabelByKey = useMemo(() => new Map(datasets.map((d) => [d.key, d.label])), [datasets]);
  const activeEndpoints = useMemo(() => endpoints.filter((endpoint) => endpoint.is_active).length, [endpoints]);

  async function fetchJsonWithTimeout(path: string, init: RequestInit, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(path, { ...init, signal: controller.signal });
      const json = await res.json().catch(() => ({}));
      return { res, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
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

    const accessResult = await fetchJsonWithTimeout(
      "/api/me/module-access",
      { headers: { Authorization: `Bearer ${token}` } },
      12000
    ).catch(() => null);
    if (!accessResult) {
      setErrorMsg("Timeout validando permisos del módulo BI.");
      setLoading(false);
      return;
    }
    const { res: accessRes, json: accessJson } = accessResult;
    if (!accessRes.ok) {
      setErrorMsg(accessJson.error || "No se pudo validar acceso.");
      setLoading(false);
      return;
    }
    const allowed = Array.isArray(accessJson.allowed_modules) ? accessJson.allowed_modules.map((v: unknown) => String(v)) : [];
    if (!allowed.includes("bi_integrations")) {
      setLoading(false);
      router.replace("/app");
      return;
    }

    const loadResult = await fetchJsonWithTimeout(
      "/api/reporting/endpoints",
      { headers: { Authorization: `Bearer ${token}` } },
      15000
    ).catch(() => null);
    if (!loadResult) {
      setErrorMsg("Timeout cargando endpoints BI.");
      setLoading(false);
      return;
    }
    const { res, json } = loadResult;
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar configuración BI.");
      setLoading(false);
      return;
    }

    const datasetsRows = Array.isArray(json.datasets) ? (json.datasets as DatasetOption[]) : [];
    setDatasets(datasetsRows);
    if (!newDatasetKey && datasetsRows[0]?.key) setNewDatasetKey(String(datasetsRows[0].key));
    setEndpoints(Array.isArray(json.endpoints) ? (json.endpoints as EndpointRow[]) : []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createEndpoint() {
    setBusy(true);
    setErrorMsg("");
    setOkMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/reporting/endpoints", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        label: newLabel,
        dataset_key: newDatasetKey,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo crear endpoint.");
      setBusy(false);
      return;
    }

    setOkMsg("Endpoint creado.");
    setNewLabel("");
    await load();
    setBusy(false);
  }

  async function toggleActive(endpoint: EndpointRow) {
    setBusy(true);
    setErrorMsg("");
    setOkMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/reporting/endpoints?id=${encodeURIComponent(endpoint.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_active: !endpoint.is_active }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo actualizar endpoint.");
      setBusy(false);
      return;
    }
    await load();
    setBusy(false);
  }

  async function rotateToken(endpointId: string) {
    setBusy(true);
    setErrorMsg("");
    setOkMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/reporting/endpoints?id=${encodeURIComponent(endpointId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rotate_token: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo rotar token.");
      setBusy(false);
      return;
    }
    setOkMsg("Token rotado.");
    await load();
    setBusy(false);
  }

  async function removeEndpoint(endpointId: string, label: string) {
    if (!confirm(`¿Eliminar endpoint "${label}"?`)) return;
    setBusy(true);
    setErrorMsg("");
    setOkMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/reporting/endpoints?id=${encodeURIComponent(endpointId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo eliminar endpoint.");
      setBusy(false);
      return;
    }
    setOkMsg("Endpoint eliminado.");
    await load();
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <section className="rounded-[26px] border border-[rgba(17,32,28,0.08)] bg-[linear-gradient(180deg,rgba(251,253,252,0.98),rgba(245,249,248,0.96))] p-4 shadow-[0_20px_60px_-44px_rgba(15,23,42,0.3)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-900 text-white hover:bg-slate-900">Configuración</Badge>
              <Badge variant="secondary" className="bg-sky-50 text-sky-700 hover:bg-sky-50">
                Integraciones BI
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Exposición segura de datasets
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Administra endpoints externos para Power BI y herramientas analíticas sin perder control del acceso.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Datasets</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{datasets.length}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Endpoints</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{endpoints.length}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Activos</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{activeEndpoints}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {errorMsg ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 whitespace-pre-wrap">{errorMsg}</div> : null}
      {okMsg ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{okMsg}</div> : null}

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Nuevo endpoint</div>
              <CardTitle className="text-base sm:text-lg">Publicar dataset</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nombre interno</label>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ej: Reporte operativo" />
              </div>

              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Dataset</label>
                <select
                  value={newDatasetKey}
                  onChange={(e) => setNewDatasetKey(e.target.value)}
                  className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                >
                  {datasets.map((dataset) => (
                    <option key={dataset.key} value={dataset.key}>
                      {dataset.label}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-slate-500">
                El slug se genera automáticamente con dos palabras y guion para facilitar integraciones.
              </p>

              <Button onClick={() => void createEndpoint()} disabled={busy || !newLabel.trim() || !newDatasetKey} className="w-full">
                Crear endpoint
              </Button>
            </CardContent>
          </Card>

          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Accesos relacionados</div>
              <CardTitle className="text-base sm:text-lg">Atajos</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Link href="/app/reports/usage">
                <Button variant="outline" className="w-full justify-start">Ir a reportes de uso</Button>
              </Link>
              <Button variant="outline" className="justify-start" onClick={() => void load()} disabled={loading || busy}>
                Refrescar configuración
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
          <CardHeader className="pb-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Endpoints publicados</div>
            <CardTitle className="text-base sm:text-lg">Conectores disponibles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            {loading ? (
              <div className="flex min-h-[60vh] items-center justify-center py-6">
                <Loader label="Cargando integraciones..." />
              </div>
            ) : endpoints.length === 0 ? (
              <p className="text-sm text-slate-500">No hay endpoints BI configurados.</p>
            ) : (
              endpoints.map((endpoint) => {
                const url = `${baseUrl()}/api/reporting/external/${encodeURIComponent(endpoint.slug)}?token=${encodeURIComponent(endpoint.endpoint_token)}`;
                return (
                  <div
                    key={endpoint.id}
                    className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.45)]"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="truncate text-base font-semibold text-slate-900">{endpoint.label}</div>
                          <Badge
                            variant="secondary"
                            className={endpoint.is_active ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "bg-slate-100 text-slate-600 hover:bg-slate-100"}
                          >
                            {endpoint.is_active ? "Activo" : "Inactivo"}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-500">
                          Dataset: {datasetLabelByKey.get(endpoint.dataset_key) ?? endpoint.dataset_key}
                        </div>
                        <div className="text-xs text-slate-500">Slug: {endpoint.slug}</div>
                        <div className="break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                          {url}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(url)}>
                          Copiar URL
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void toggleActive(endpoint)} disabled={busy}>
                          {endpoint.is_active ? "Desactivar" : "Activar"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void rotateToken(endpoint.id)} disabled={busy}>
                          Rotar token
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void removeEndpoint(endpoint.id, endpoint.label)} disabled={busy}>
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
