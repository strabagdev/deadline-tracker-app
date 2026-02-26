"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    if (!token) return;

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
    if (!token) return;

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
    if (!token) return;

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
    if (!token) return;

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

  async function removeEndpoint(endpointId: string) {
    if (!confirm("¿Eliminar endpoint?")) return;
    setBusy(true);
    setErrorMsg("");
    setOkMsg("");
    const token = await getTokenOrRedirect();
    if (!token) return;

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
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="app-page-title">Integraciones BI</CardTitle>
              <p className="app-page-subtitle">Administra endpoints externos para Power BI y otras herramientas.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app/reports/usage">
                <Button variant="outline" size="sm">Reportes</Button>
              </Link>
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy}>
                Refrescar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <div className="app-alert app-alert-error whitespace-pre-wrap">{errorMsg}</div> : null}
      {okMsg ? <div className="app-alert app-alert-success">{okMsg}</div> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Nuevo endpoint</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 md:grid-cols-[220px_minmax(220px,1fr)_auto]">
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Nombre interno" />
            <select
              value={newDatasetKey}
              onChange={(e) => setNewDatasetKey(e.target.value)}
              className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
            >
              {datasets.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
            <Button onClick={() => void createEndpoint()} disabled={busy || !newLabel.trim() || !newDatasetKey}>
              Crear
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--muted-foreground)]">El slug se genera automáticamente con 2 palabras y guion.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Endpoints configurados</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader label="Cargando integraciones..." />
            </div>
          ) : endpoints.length === 0 ? (
            <p className="app-empty">No hay endpoints BI configurados.</p>
          ) : (
            <div className="grid gap-2">
              {endpoints.map((ep) => {
                const url = `${baseUrl()}/api/reporting/external/${encodeURIComponent(ep.slug)}?token=${encodeURIComponent(ep.endpoint_token)}`;
                return (
                  <div key={ep.id} className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[var(--card)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--foreground)]">{ep.label}</div>
                        <div className="truncate text-xs text-[var(--muted-foreground)]">
                          Dataset: {datasetLabelByKey.get(ep.dataset_key) ?? ep.dataset_key} · Slug: {ep.slug}
                        </div>
                        <div className="truncate text-xs text-[var(--muted-foreground)]">{url}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(url)}>
                          Copiar URL
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void toggleActive(ep)} disabled={busy}>
                          {ep.is_active ? "Desactivar" : "Activar"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void rotateToken(ep.id)} disabled={busy}>
                          Rotar token
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void removeEndpoint(ep.id)} disabled={busy}>
                          Eliminar
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
