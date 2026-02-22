"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type EntityType = {
  id: string;
  name: string;
};

type EntityRow = {
  id: string;
  name: string;
  entity_type_id: string;
  tracks_usage: boolean;
  usage_unit_id?: string | null;
  deadlines?: Array<{
    id: string;
    frequency_unit: string | null;
    deadline_types?: { measure_by: "date" | "usage"; is_active: boolean } | null;
  }> | null;
  entity_types?: EntityType | null;
};

type LatestUsageByEntity = Record<string, { value: number; logged_at: string; logged_on?: string | null }>;
type UsageUnit = { id: string; name: string; is_active: boolean; show_in_usage_records?: boolean };
type UsageField = {
  id: string;
  usage_unit_id: string;
  name: string;
  key: string;
  field_type: "text" | "number" | "date" | "boolean" | "select";
  options?: unknown;
};

function todayDateInput() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function UsagePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [usageUnits, setUsageUnits] = useState<UsageUnit[]>([]);
  const [usageFieldsByUnit, setUsageFieldsByUnit] = useState<Record<string, UsageField[]>>({});

  const [q, setQ] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loggedAtDate, setLoggedAtDate] = useState(todayDateInput());

  const [draftByEntity, setDraftByEntity] = useState<Record<string, string>>({});
  const [fieldDraftByEntity, setFieldDraftByEntity] = useState<Record<string, Record<string, string>>>({});
  const [savingByEntity, setSavingByEntity] = useState<Record<string, boolean>>({});

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

  async function load() {
    setLoading(true);
    setErrorMsg("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/dashboard", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar módulo de uso.");
      setLoading(false);
      return;
    }

    const allEntities = (json.entities ?? []) as EntityRow[];
    const tracked = allEntities.filter((e) => e.tracks_usage);
    setEntities(tracked);
    setUsage((json.latest_usage_by_entity ?? {}) as LatestUsageByEntity);

    const unitsRes = await fetch("/api/usage-units?active=1", { headers: { Authorization: `Bearer ${token}` } });
    const unitsJson = await unitsRes.json().catch(() => ({}));
    if (unitsRes.ok) {
      const units = (unitsJson.usage_units ?? []) as UsageUnit[];
      setUsageUnits(units);

      const fieldPairs = await Promise.all(
        units.map(async (u) => {
          const res = await fetch(`/api/usage-fields?usage_unit_id=${encodeURIComponent(u.id)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = await res.json().catch(() => ({}));
          const fields = (res.ok ? json.usage_fields : []) as UsageField[];
          return [u.id, fields] as const;
        })
      );
      const byUnit: Record<string, UsageField[]> = {};
      for (const [unitId, fields] of fieldPairs) byUnit[unitId] = fields;
      setUsageFieldsByUnit(byUnit);

    } else {
      setUsageUnits([]);
      setUsageFieldsByUnit({});
    }
    setLoading(false);
  }

  function getEntityUsageFields(entity: EntityRow) {
    const unitId = String(entity.usage_unit_id ?? "").trim();
    if (!unitId) return [];
    return usageFieldsByUnit[unitId] ?? [];
  }

  function getEntityUsageMeta(entity: EntityRow) {
    const unitId = String(entity.usage_unit_id ?? "").trim();
    if (!unitId) return { unitName: "", showUnitName: false, reason: "La entidad no tiene unidad de uso asignada." };
    const unit = usageUnits.find((u) => u.id === unitId) ?? null;
    const unitName = unit?.name ?? "";
    const showUnitName = unit?.show_in_usage_records !== false;
    if (!unitName) return { unitName: "", showUnitName: false, reason: "La unidad asignada no está activa o no existe en el catálogo." };
    const fields = usageFieldsByUnit[unitId] ?? [];
    if (fields.length === 0) return { unitName, showUnitName, reason: "Sin campos configurados para esta unidad." };
    return { unitName, showUnitName, reason: "" };
  }

  async function saveUsage(entityId: string) {
    setErrorMsg("");
    setOkMsg("");

    const entity = entities.find((e) => e.id === entityId);
    const dynamicFields = entity ? getEntityUsageFields(entity) : [];
    const dynamicDraft = fieldDraftByEntity[entityId] ?? {};
    const fieldValues = dynamicFields
      .map((f) => {
        const raw = dynamicDraft[f.id] ?? "";
        if (raw === "") return null;
        if (f.field_type === "number") return { usage_field_id: f.id, value: Number(raw) };
        if (f.field_type === "boolean") return { usage_field_id: f.id, value: raw === "true" };
        return { usage_field_id: f.id, value: raw };
      })
      .filter((v): v is { usage_field_id: string; value: string | number | boolean } => Boolean(v));

    const rawValue = (draftByEntity[entityId] ?? "").trim();
    let value: number | null = null;
    let valueText: string | null = null;
    if (!rawValue) {
      if (fieldValues.length === 0) {
        setErrorMsg("Ingresa un valor de uso o completa al menos un campo dinámico.");
        return;
      }
      const latestValue = usage[entityId]?.value;
      value = Number.isFinite(Number(latestValue)) ? Number(latestValue) : 0;
    } else {
      const numeric = Number(rawValue);
      if (Number.isFinite(numeric)) {
        if (numeric < 0) {
          setErrorMsg("Ingresa un valor numérico válido (mayor o igual a 0).");
          return;
        }
        value = numeric;
      } else {
        valueText = rawValue;
      }
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    setSavingByEntity((prev) => ({ ...prev, [entityId]: true }));
    try {
      const payload: Record<string, unknown> = {
        entity_id: entityId,
      };
      if (value != null) payload.value = value;
      if (valueText) payload.value_text = valueText;
      if (fieldValues.length > 0) payload.field_values = fieldValues;
      if (loggedAtDate) {
        payload.logged_on = loggedAtDate;
      }

      const res = await fetch("/api/usage-logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(json.error || "No se pudo registrar uso.");
        return;
      }

      setDraftByEntity((prev) => ({ ...prev, [entityId]: "" }));
      setFieldDraftByEntity((prev) => ({ ...prev, [entityId]: {} }));
      setOkMsg("Uso registrado correctamente.");
      await load();
    } finally {
      setSavingByEntity((prev) => ({ ...prev, [entityId]: false }));
    }
  }

  const typeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) {
      const t = e.entity_types;
      if (t?.id) map.set(t.id, t.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entities]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entities
      .filter((e) => {
        if (filterType !== "all" && e.entity_type_id !== filterType) return false;
        if (!needle) return true;
        const typeName = (e.entity_types?.name ?? "").toLowerCase();
        return e.name.toLowerCase().includes(needle) || typeName.includes(needle);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entities, filterType, q]);

  useEffect(() => {
    setPage(1);
  }, [q, filterType, pageSize]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(pageStart, pageStart + pageSize);

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Registro de Uso</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Carga rápida de uso para entidades con seguimiento activo.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <Link href="/app/entities">
                <Button variant="outline" size="sm">Entidades</Button>
              </Link>
              <Button onClick={load} variant="outline" size="sm" disabled={loading}>
                Refrescar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <p className="whitespace-pre-wrap text-sm text-rose-600">{errorMsg}</p> : null}
      {okMsg ? <p className="whitespace-pre-wrap text-sm text-emerald-700">{okMsg}</p> : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Búsqueda y paginación</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_180px_130px]">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar entidad o tipo..."
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="all">Todos los tipos</option>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              value={String(pageSize)}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="25">25 / pág</option>
              <option value="50">50 / pág</option>
              <option value="100">100 / pág</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Contexto de carga</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid gap-2 md:grid-cols-[220px_120px_minmax(220px,1fr)]">
            <Input
              type="date"
              value={loggedAtDate}
              onChange={(e) => setLoggedAtDate(e.target.value)}
              title="Fecha de registro"
            />
            <Button
              variant="outline"
              onClick={() => setLoggedAtDate(todayDateInput())}
              className="h-10"
            >
              Restablecer
            </Button>
            <div className="flex items-center text-xs text-slate-500">
              La fecha seleccionada se aplica a todos los registros que guardes desde esta pantalla.
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader label="Cargando módulo de uso..." />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-slate-600">No hay entidades con `tracks_usage` para mostrar.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border bg-white">
              <div className="grid min-w-[760px] grid-cols-[1.3fr_0.9fr_0.9fr_1fr] border-b bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                <div>Entidad</div>
                <div>Último uso</div>
                <div>Fecha último</div>
                <div>Nuevo registro + campos</div>
              </div>
              {pagedRows.map((e) => {
                const latest = usage[e.id];
                const saving = Boolean(savingByEntity[e.id]);
                const dynamicFields = getEntityUsageFields(e);
                const usageMeta = getEntityUsageMeta(e);
                return (
                  <div key={e.id} className="grid min-w-[760px] grid-cols-[1.3fr_0.9fr_0.9fr_1fr] items-center gap-2 border-b px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{e.name}</div>
                      <div className="truncate text-[11px] text-slate-500">{e.entity_types?.name ?? "Sin tipo"}</div>
                    </div>
                    <div className="text-sm font-medium text-slate-800">{latest?.value ?? "—"}</div>
                    <div className="text-xs text-slate-500">
                      {latest?.logged_on || (latest?.logged_at ? new Date(latest.logged_at).toLocaleDateString(undefined, { timeZone: "UTC" }) : "—")}
                    </div>
                    <div className="grid gap-2">
                      <div className="flex items-center gap-2">
                        <Input
                          value={draftByEntity[e.id] ?? ""}
                          onChange={(ev) => setDraftByEntity((prev) => ({ ...prev, [e.id]: ev.target.value }))}
                          placeholder="Ej: 1245 o Estado OK"
                          className="h-9"
                          disabled={saving}
                        />
                        <Button
                          size="sm"
                          onClick={() => void saveUsage(e.id)}
                          disabled={saving}
                          className="h-9"
                        >
                          {saving ? "..." : "Guardar"}
                        </Button>
                      </div>
                      {dynamicFields.length > 0 ? (
                        <div className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          {dynamicFields.map((f) => {
                            const current = fieldDraftByEntity[e.id]?.[f.id] ?? "";
                            const selectOptions = Array.isArray(f.options)
                              ? f.options.map((x) => String(x))
                              : [];
                            return (
                              <div key={f.id} className="grid gap-1">
                                <label className="text-[11px] font-medium text-slate-600">{f.name}</label>
                                {f.field_type === "boolean" ? (
                                  <select
                                    value={current}
                                    onChange={(ev) =>
                                      setFieldDraftByEntity((prev) => ({
                                        ...prev,
                                        [e.id]: { ...(prev[e.id] ?? {}), [f.id]: ev.target.value },
                                      }))
                                    }
                                    disabled={saving}
                                    className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                                  >
                                    <option value="">Sin dato</option>
                                    <option value="true">Sí</option>
                                    <option value="false">No</option>
                                  </select>
                                ) : f.field_type === "select" && selectOptions.length > 0 ? (
                                  <select
                                    value={current}
                                    onChange={(ev) =>
                                      setFieldDraftByEntity((prev) => ({
                                        ...prev,
                                        [e.id]: { ...(prev[e.id] ?? {}), [f.id]: ev.target.value },
                                      }))
                                    }
                                    disabled={saving}
                                    className="h-9 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                                  >
                                    <option value="">Selecciona...</option>
                                    {selectOptions.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <Input
                                    value={current}
                                    onChange={(ev) =>
                                      setFieldDraftByEntity((prev) => ({
                                        ...prev,
                                        [e.id]: { ...(prev[e.id] ?? {}), [f.id]: ev.target.value },
                                      }))
                                    }
                                    type={f.field_type === "date" ? "date" : "text"}
                                    inputMode={f.field_type === "number" ? "decimal" : "text"}
                                    placeholder={f.field_type === "number" ? "Ej: 10.5" : ""}
                                    className="h-9"
                                    disabled={saving}
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                          {usageMeta.showUnitName && usageMeta.unitName ? `Unidad: ${usageMeta.unitName}. ` : ""}
                          {usageMeta.reason}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

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
                  className="h-10 min-w-10 px-2"
                >
                  ◀
                </Button>
                <div className="px-1 text-xs text-slate-600">Página {safePage} de {totalPages}</div>
                <Button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  variant="outline"
                  size="sm"
                  className="h-10 min-w-10 px-2"
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
