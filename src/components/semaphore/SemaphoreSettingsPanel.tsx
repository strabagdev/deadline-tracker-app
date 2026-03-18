"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export type SemaphoreSettings = {
  yellow_days: number;
  orange_days: number;
  red_days: number;
  label_green: string;
  label_yellow: string;
  label_orange: string;
  label_red: string;
};

type SettingsPayload = {
  role?: string;
  settings?: Partial<SemaphoreSettings>;
};

type SemaphoreSettingsPanelProps = {
  title?: string;
  description?: string;
  headerActions?: React.ReactNode;
  onSaved?: (settings: SemaphoreSettings) => void;
};

const DEFAULT_SETTINGS: SemaphoreSettings = {
  yellow_days: 60,
  orange_days: 30,
  red_days: 15,
  label_green: "Al día",
  label_yellow: "Aviso",
  label_orange: "Por vencer",
  label_red: "Vencido",
};

function readApiError(payload: unknown) {
  if (payload && typeof payload === "object" && "error" in payload) {
    const err = (payload as { error?: unknown }).error;
    return typeof err === "string" ? err : "";
  }
  return "";
}

export function SemaphoreSettingsPanel({
  title = "Semáforo",
  description,
  headerActions,
  onSaved,
}: SemaphoreSettingsPanelProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [role, setRole] = useState("");
  const [settings, setSettings] = useState<SemaphoreSettings>(DEFAULT_SETTINGS);

  const helpText = useMemo(
    () =>
      description ??
      "Estados: verde, amarillo, naranja y rojo. Se aplican a FECHA (días restantes) y USO (días estimados).",
    [description]
  );

  const canEdit = role === "owner" || role === "admin";

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

  function validateLocal(next: SemaphoreSettings) {
    const y = Number(next.yellow_days);
    const o = Number(next.orange_days);
    const r = Number(next.red_days);

    if (![y, o, r].every((n) => Number.isFinite(n))) return "Los umbrales deben ser numéricos.";
    if (y < 0 || o < 0 || r < 0) return "Los umbrales no pueden ser negativos.";
    if (!(y >= o && o >= r)) return "Debe cumplirse: yellow ≥ orange ≥ red.";
    if (![next.label_green, next.label_yellow, next.label_orange, next.label_red].every((v) => String(v).trim().length > 0)) {
      return "Los nombres de estado no pueden estar vacíos.";
    }
    return "";
  }

  async function load() {
    setLoading(true);
    setErrorMsg("");
    setOkMsg("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

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

    setRole(String(json.role || ""));
    setSettings({
      yellow_days: Number(json.settings?.yellow_days ?? DEFAULT_SETTINGS.yellow_days),
      orange_days: Number(json.settings?.orange_days ?? DEFAULT_SETTINGS.orange_days),
      red_days: Number(json.settings?.red_days ?? DEFAULT_SETTINGS.red_days),
      label_green: String(json.settings?.label_green ?? DEFAULT_SETTINGS.label_green),
      label_yellow: String(json.settings?.label_yellow ?? DEFAULT_SETTINGS.label_yellow),
      label_orange: String(json.settings?.label_orange ?? DEFAULT_SETTINGS.label_orange),
      label_red: String(json.settings?.label_red ?? DEFAULT_SETTINGS.label_red),
    });
    setLoading(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setOkMsg("");

    const msg = validateLocal(settings);
    if (msg) {
      setErrorMsg(msg);
      return;
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    setSaving(true);

    const payload = {
      yellow_days: Math.trunc(settings.yellow_days),
      orange_days: Math.trunc(settings.orange_days),
      red_days: Math.trunc(settings.red_days),
      label_green: String(settings.label_green).trim(),
      label_yellow: String(settings.label_yellow).trim(),
      label_orange: String(settings.label_orange).trim(),
      label_red: String(settings.label_red).trim(),
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

    setSettings(payload);
    setOkMsg("Guardado. Aplica para vencimientos por fecha y por uso.");
    onSaved?.(payload);
    setSaving(false);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{title}</CardTitle>
            <p className="mt-1 text-sm text-slate-500">{helpText}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading || saving}>
              Actualizar
            </Button>
            {headerActions}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-1">
        {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}
        {okMsg ? <p className="text-sm text-emerald-700">{okMsg}</p> : null}

        {!canEdit && !loading ? (
          <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
            Solo owner/admin puede editar
          </Badge>
        ) : null}

        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center py-8">
            <Loader label="Cargando configuración..." />
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="rounded-2xl border bg-slate-50 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-emerald-300 bg-emerald-100 text-emerald-800">{settings.label_green}</Badge>
                <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">{settings.label_yellow}</Badge>
                <Badge variant="outline" className="border-orange-300 bg-orange-100 text-orange-800">{settings.label_orange}</Badge>
                <Badge variant="outline" className="border-rose-300 bg-rose-100 text-rose-800">
                  {settings.label_red} {"(días <= 0)"}
                </Badge>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1.5 text-xs text-slate-600">
                  Umbral Yellow (días)
                  <Input
                    disabled={!canEdit || saving}
                    value={String(settings.yellow_days)}
                    onChange={(e) => setSettings((prev) => ({ ...prev, yellow_days: Number(e.target.value) }))}
                    inputMode="numeric"
                  />
                </label>
                <label className="grid gap-1.5 text-xs text-slate-600">
                  Umbral Orange (días)
                  <Input
                    disabled={!canEdit || saving}
                    value={String(settings.orange_days)}
                    onChange={(e) => setSettings((prev) => ({ ...prev, orange_days: Number(e.target.value) }))}
                    inputMode="numeric"
                  />
                </label>
                <label className="grid gap-1.5 text-xs text-slate-600">
                  Umbral Red (días)
                  <Input
                    disabled={!canEdit || saving}
                    value={String(settings.red_days)}
                    onChange={(e) => setSettings((prev) => ({ ...prev, red_days: Number(e.target.value) }))}
                    inputMode="numeric"
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-4">
                <label className="grid gap-1.5 text-xs text-slate-600">
                  Nombre estado verde
                  <Input
                    disabled={!canEdit || saving}
                    value={settings.label_green}
                    onChange={(e) => setSettings((prev) => ({ ...prev, label_green: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-xs text-slate-600">
                  Nombre estado amarillo
                  <Input
                    disabled={!canEdit || saving}
                    value={settings.label_yellow}
                    onChange={(e) => setSettings((prev) => ({ ...prev, label_yellow: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-xs text-slate-600">
                  Nombre estado naranjo
                  <Input
                    disabled={!canEdit || saving}
                    value={settings.label_orange}
                    onChange={(e) => setSettings((prev) => ({ ...prev, label_orange: e.target.value }))}
                  />
                </label>
                <label className="grid gap-1.5 text-xs text-slate-600">
                  Nombre estado rojo
                  <Input
                    disabled={!canEdit || saving}
                    value={settings.label_red}
                    onChange={(e) => setSettings((prev) => ({ ...prev, label_red: e.target.value }))}
                  />
                </label>
              </div>

              <p className="mt-3 text-xs text-slate-500">Regla obligatoria: yellow ≥ orange ≥ red.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!canEdit || saving}>
                {saving ? "Guardando..." : "Guardar cambios"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void load()} disabled={loading || saving}>
                Revertir
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
