"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

type SettingsPayload = {
  organization_id?: string;
  role?: string;
  settings?: Partial<{
    yellow_days: number;
    orange_days: number;
    red_days: number;
    label_green: string;
    label_yellow: string;
    label_orange: string;
    label_red: string;
  }>;
};

type UnifiedThresholds = {
  yellow_days: number;
  orange_days: number;
  red_days: number;
  label_green: string;
  label_yellow: string;
  label_orange: string;
  label_red: string;
};

function readApiError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error?: unknown }).error;
    return typeof err === "string" ? err : "";
  }
  return "";
}

export default function SemaphoreSettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [orgId, setOrgId] = useState<string>("");
  const [role, setRole] = useState<string>("");

  const [t, setT] = useState<UnifiedThresholds>({
    yellow_days: 60,
    orange_days: 30,
    red_days: 15,
    label_green: "Al día",
    label_yellow: "Aviso",
    label_orange: "Por vencer",
    label_red: "Vencido",
  });

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  function validateLocal(th: UnifiedThresholds) {
    const y = Number(th.yellow_days);
    const o = Number(th.orange_days);
    const r = Number(th.red_days);

    if (![y, o, r].every((n) => Number.isFinite(n))) return "Los umbrales deben ser numéricos.";
    if (y < 0 || o < 0 || r < 0) return "Los umbrales no pueden ser negativos.";
    if (!(y >= o && o >= r)) return "Debe cumplirse: yellow ≥ orange ≥ red.";
    if (![th.label_green, th.label_yellow, th.label_orange, th.label_red].every((v) => String(v).trim().length > 0)) {
      return "Los nombres de estado no pueden estar vacíos.";
    }
    return "";
  }

  async function load() {
    setLoading(true);
    setErrorMsg("");
    setOkMsg("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/settings/semaphore", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const payload: unknown = await res.json().catch(() => ({}));
    const json = payload as SettingsPayload;
    if (!res.ok) {
      setErrorMsg(readApiError(payload) || "No se pudo cargar configuración");
      setLoading(false);
      return;
    }

    setOrgId(String(json.organization_id || ""));
    setRole(String(json.role || ""));

    const s = json.settings || {};
    setT({
      yellow_days: Number(s.yellow_days ?? 60),
      orange_days: Number(s.orange_days ?? 30),
      red_days: Number(s.red_days ?? 15),
      label_green: String(s.label_green ?? "Al día"),
      label_yellow: String(s.label_yellow ?? "Aviso"),
      label_orange: String(s.label_orange ?? "Por vencer"),
      label_red: String(s.label_red ?? "Vencido"),
    });

    setLoading(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setOkMsg("");

    const msg = validateLocal(t);
    if (msg) {
      setErrorMsg(msg);
      return;
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    setSaving(true);

    const payload = {
      yellow_days: Math.trunc(t.yellow_days),
      orange_days: Math.trunc(t.orange_days),
      red_days: Math.trunc(t.red_days),
      label_green: String(t.label_green).trim(),
      label_yellow: String(t.label_yellow).trim(),
      label_orange: String(t.label_orange).trim(),
      label_red: String(t.label_red).trim(),
    };

    const res = await fetch("/api/settings/semaphore", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });

    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(readApiError(json) || "No se pudo guardar");
      setSaving(false);
      return;
    }

    setOkMsg("Guardado. Aplica para vencimientos por fecha y por uso.");
    setSaving(false);
  }

  const canEdit = role === "owner" || role === "admin";

  const helpText = useMemo(
    () =>
      "Estados: verde, amarillo, naranja y rojo. " +
      "Se aplican a FECHA (días restantes) y USO (días estimados).",
    []
  );

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Semáforo</CardTitle>
              <p className="mt-1 text-sm text-slate-500">{helpText}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <Button onClick={load} variant="outline" size="sm" disabled={loading || saving}>
                Actualizar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}
      {okMsg ? <p className="text-sm text-emerald-700">{okMsg}</p> : null}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Org activa: {orgId || "—"}</Badge>
            <Badge variant="outline">Rol: {role || "—"}</Badge>
            {!canEdit ? <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">Solo owner/admin puede editar</Badge> : null}
          </div>
        </CardHeader>
        <CardContent className="pt-1">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader label="Cargando configuración..." />
            </div>
          ) : (
            <form onSubmit={save} className="space-y-4">
              <div className="rounded-2xl border bg-slate-50 p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-800">🟢 {t.label_green}</Badge>
                  <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">🟡 {t.label_yellow}</Badge>
                  <Badge variant="outline" className="border-orange-300 bg-orange-100 text-orange-800">🟠 {t.label_orange}</Badge>
                  <Badge variant="outline" className="border-rose-300 bg-rose-100 text-rose-800">🔴 {t.label_red} (días ≤ 0)</Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Umbral Yellow (días)
                    <Input
                      disabled={!canEdit || saving}
                      value={String(t.yellow_days)}
                      onChange={(e) => setT((p) => ({ ...p, yellow_days: Number(e.target.value) }))}
                      inputMode="numeric"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Umbral Orange (días)
                    <Input
                      disabled={!canEdit || saving}
                      value={String(t.orange_days)}
                      onChange={(e) => setT((p) => ({ ...p, orange_days: Number(e.target.value) }))}
                      inputMode="numeric"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Umbral Red (días)
                    <Input
                      disabled={!canEdit || saving}
                      value={String(t.red_days)}
                      onChange={(e) => setT((p) => ({ ...p, red_days: Number(e.target.value) }))}
                      inputMode="numeric"
                    />
                  </label>
                </div>

                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Nombre estado verde
                    <Input
                      disabled={!canEdit || saving}
                      value={t.label_green}
                      onChange={(e) => setT((p) => ({ ...p, label_green: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Nombre estado amarillo
                    <Input
                      disabled={!canEdit || saving}
                      value={t.label_yellow}
                      onChange={(e) => setT((p) => ({ ...p, label_yellow: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Nombre estado naranjo
                    <Input
                      disabled={!canEdit || saving}
                      value={t.label_orange}
                      onChange={(e) => setT((p) => ({ ...p, label_orange: e.target.value }))}
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs text-slate-600">
                    Nombre estado rojo
                    <Input
                      disabled={!canEdit || saving}
                      value={t.label_red}
                      onChange={(e) => setT((p) => ({ ...p, label_red: e.target.value }))}
                    />
                  </label>
                </div>

                <p className="mt-3 text-xs text-slate-500">Regla obligatoria: yellow ≥ orange ≥ red.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={!canEdit || saving}>
                  {saving ? "Guardando..." : "Guardar cambios"}
                </Button>
                <Button type="button" variant="outline" onClick={load} disabled={loading || saving}>
                  Revertir
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
