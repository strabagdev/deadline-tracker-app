"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { pickNearestDeadline } from "@/lib/deadlines/calculateDeadlineStatus";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseCsv } from "@/lib/csv/simpleCsv";

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

type EntityType = {
  id: string;
  name: string;
};

type EntityRow = {
  id: string;
  name: string;
  created_at: string;
  entity_type_id: string;
  usage_unit_id?: string | null;
  entity_types?: EntityType | null;
  card_fields?: Array<{ name: string; value_text: string }>;
  nearest_forecast?: {
    deadline_id: string;
    deadline_name: string;
    measure_by: "date" | "usage" | "unknown";
    forecast_due_date: string | null;
    days_remaining: number | null;
    risk_level: Status;
    risk_score: number;
  } | null;
  deadlines?: Deadline[] | null;
};

type UsageUnit = {
  id: string;
  name: string;
  is_active: boolean;
};

type LatestUsageByEntity = Record<string, { value: number; logged_at: string }>;
type Status = "red" | "orange" | "yellow" | "green" | "none";
type SortMode = "critical" | "name" | "type" | "created";

type SemaphoreSettings = {
  yellow_days: number;
  orange_days: number;
  red_days: number;
  label_green: string;
  label_yellow: string;
  label_orange: string;
  label_red: string;
};

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

function statusBadgeClasses(status: Status) {
  return status === "red"
    ? "border-rose-300 bg-rose-100 text-rose-800"
    : status === "orange"
      ? "border-orange-300 bg-orange-100 text-orange-800"
      : status === "yellow"
        ? "border-amber-300 bg-amber-100 text-amber-800"
        : status === "green"
          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
          : "border-slate-300 bg-slate-100 text-slate-700";
}

async function getXlsxModule() {
  const mod = await import("xlsx");
  return (mod as unknown as { default?: typeof mod }).default ?? mod;
}

export default function EntitiesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const autoOpenCreate = searchParams.get("new") === "1";
  const deletedSuccess = searchParams.get("deleted") === "1";
  const [showCreate, setShowCreate] = useState<boolean>(autoOpenCreate);
  const [flashMsg, setFlashMsg] = useState<string>("");

  const [createName, setCreateName] = useState<string>("");
  const [createEntityTypeId, setCreateEntityTypeId] = useState<string>("");
  const [createTracksUsage, setCreateTracksUsage] = useState<boolean>(false);
  const [createUsageUnitId, setCreateUsageUnitId] = useState<string>("");
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [usageUnits, setUsageUnits] = useState<UsageUnit[]>([]);
  const [typesLoading, setTypesLoading] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [importOpen, setImportOpen] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);
  const [importCsvText, setImportCsvText] = useState<string>("");
  const [importResult, setImportResult] = useState<string>("");
  const [importCanApply, setImportCanApply] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [importStage, setImportStage] = useState<string>("");
  const [importApplying, setImportApplying] = useState<boolean>(false);
  const [importMode, setImportMode] = useState<"update" | "create">("update");
  const [bulkPanel, setBulkPanel] = useState<"import" | "export">("import");
  const [bulkEntityTypeId, setBulkEntityTypeId] = useState<string>("all");

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("critical");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [searchPanelCollapsed, setSearchPanelCollapsed] = useState(true);

  const [semaphore, setSemaphore] = useState<SemaphoreSettings>({
    yellow_days: 60,
    orange_days: 30,
    red_days: 15,
    label_green: "Al día",
    label_yellow: "Aviso",
    label_orange: "Por vencer",
    label_red: "Vencido",
  });

  const statusFilterMeta = useMemo<Array<{ key: Status | "all"; title: string }>>(
    () => [
      { key: "all", title: "Todos" },
      { key: "red", title: semaphore.label_red || "Vencido" },
      { key: "orange", title: semaphore.label_orange || "Por vencer" },
      { key: "yellow", title: semaphore.label_yellow || "Aviso" },
      { key: "green", title: semaphore.label_green || "Al día" },
      { key: "none", title: "Sin info" },
    ],
    [semaphore.label_green, semaphore.label_yellow, semaphore.label_orange, semaphore.label_red]
  );
  const importProgressClamped = Math.max(0, Math.min(100, importProgress));
  const importRingRadius = 46;
  const importRingCircumference = 2 * Math.PI * importRingRadius;

  useEffect(() => {
    void loadEntityTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!createTracksUsage) return;
    if (createUsageUnitId) return;
    if (usageUnits.length > 0) setCreateUsageUnitId(usageUnits[0].id);
  }, [createTracksUsage, createUsageUnitId, usageUnits]);

  useEffect(() => {
    if (!deletedSuccess) return;
    setFlashMsg("Entidad eliminada correctamente.");
    router.replace("/app/entities", { scroll: false });
  }, [deletedSuccess, router]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEntityTypes() {
    setTypesLoading(true);

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setTypesLoading(false);
      router.replace("/login");
      return;
    }

    const [typesRes, unitsRes] = await Promise.all([
      fetch("/api/entity-types", { headers: { Authorization: `Bearer ${token}` } }),
      fetch("/api/usage-units?active=1", { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    const typesJson = await typesRes.json().catch(() => ({}));
    const unitsJson = await unitsRes.json().catch(() => ({}));
    if (typesRes.ok) {
      const list = (typesJson.entity_types ?? typesJson.data ?? typesJson ?? []) as EntityType[];
      const safe = Array.isArray(list) ? list : [];
      setEntityTypes(safe);
      if (!createEntityTypeId && safe[0]?.id) setCreateEntityTypeId(safe[0].id);
    }
    if (unitsRes.ok) {
      const list = (unitsJson.usage_units ?? []) as UsageUnit[];
      const safe = Array.isArray(list) ? list : [];
      setUsageUnits(safe);
      if (!createUsageUnitId && safe[0]?.id) setCreateUsageUnitId(safe[0].id);
    }

    setTypesLoading(false);
  }

  async function load() {
    setLoading(true);
    setErrorMsg("");

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setLoading(false);
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/dashboard?mode=operations", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar entidades");
      setEntities([]);
      setUsage({});
      setLoading(false);
      return;
    }

    setEntities(json.entities ?? []);
    setUsage(json.latest_usage_by_entity ?? {});

    const sres = await fetch("/api/settings/semaphore", { headers: { Authorization: `Bearer ${token}` } });
    const sjson = await sres.json().catch(() => ({}));
    if (sres.ok && sjson?.settings) {
      setSemaphore({
        yellow_days: Number(sjson.settings.yellow_days ?? 60),
        orange_days: Number(sjson.settings.orange_days ?? 30),
        red_days: Number(sjson.settings.red_days ?? 15),
        label_green: String(sjson.settings.label_green ?? "Al día"),
        label_yellow: String(sjson.settings.label_yellow ?? "Aviso"),
        label_orange: String(sjson.settings.label_orange ?? "Por vencer"),
        label_red: String(sjson.settings.label_red ?? "Vencido"),
      });
    }

    setLoading(false);
  }

  async function createEntityInline(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    const name = createName.trim();
    if (!name) {
      setErrorMsg("Ingresa un nombre para la entidad.");
      return;
    }
    if (!createEntityTypeId) {
      setErrorMsg("Selecciona un tipo de entidad.");
      return;
    }

    setCreating(true);

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setCreating(false);
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/entities", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        entity_type_id: createEntityTypeId,
        tracks_usage: createTracksUsage,
        usage_unit_id: createTracksUsage ? (createUsageUnitId || null) : null,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo crear la entidad.");
      setCreating(false);
      return;
    }

    setCreateName("");
    setCreateTracksUsage(false);
    setCreateUsageUnitId(usageUnits[0]?.id ?? "");
    setShowCreate(false);

    const id = json.entity?.id || json.id;
    if (id) {
      router.push(`/app/entities/${id}`);
    } else {
      await load();
    }

    setCreating(false);
  }

  async function downloadExcelFromCsvEndpoint(path: string, fileName: string) {
    setErrorMsg("");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setErrorMsg(json.error || "No se pudo descargar archivo Excel");
      return;
    }
    const csvText = await res.text();
    const rows = parseCsv(csvText);
    const XLSX = await getXlsxModule();
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Entidades");
    const output = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const safeName = fileName.toLowerCase().endsWith(".xlsx") ? fileName : fileName.replace(/\.[^.]+$/u, ".xlsx");
    const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = safeName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function runImport(applyNow = false, csvOverride?: string) {
    const csvPayload = (csvOverride ?? importCsvText).trim();
    if (!csvPayload) {
      setImportResult("Selecciona un archivo válido para importar.");
      setImportCanApply(false);
      return;
    }
    setImportApplying(applyNow);
    setImporting(true);
    setImportResult("");
    setErrorMsg("");
    setImportProgress(55);
    setImportStage(applyNow ? "Aplicando cambios..." : "Validando archivo...");

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setImporting(false);
      setImportApplying(false);
      setImportProgress(0);
      setImportStage("");
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/entities/bulk/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        csv: csvPayload,
        apply: applyNow,
        import_mode: importMode,
        entity_type_id: bulkEntityTypeId !== "all" ? bulkEntityTypeId : null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    setImportProgress(88);
    if (!res.ok) {
      const errs = Array.isArray(json?.errors)
        ? json.errors.slice(0, 8).map((e: { line: number; message: string }) => `L${e.line}: ${e.message}`).join("\n")
        : "";
      setImportResult(`${json.error || "Importación inválida"}${errs ? `\n${errs}` : ""}`);
      setImportCanApply(false);
      setImporting(false);
      setImportApplying(false);
      setImportProgress(0);
      setImportStage("");
      return;
    }

    const summary = json?.summary ?? {};
    if (json?.mode === "validate") {
      setImportResult(
        `Validación OK.\nFilas: ${summary.total_rows ?? 0}\nCrear: ${summary.to_create ?? 0}\nActualizar: ${summary.to_update ?? 0}`
      );
      setImportCanApply(true);
      setImportProgress(100);
      setImportStage("Validación completada");
    } else {
      setImportResult(
        `Carga aplicada.\nFilas: ${summary.total_rows ?? 0}\nCreadas: ${summary.created ?? 0}\nActualizadas: ${summary.updated ?? 0}\nErrores: ${summary.errors ?? 0}`
      );
      setImportCanApply(false);
      await load();
      setImportProgress(100);
      setImportStage("Carga completada");
    }
    setImporting(false);
    setImportApplying(false);
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
      const nf = e.nearest_forecast ?? null;
      const computedNearest = pickNearestDeadline(e.deadlines, latest, {
        yellowDays: Number(semaphore.yellow_days ?? 60),
        orangeDays: Number(semaphore.orange_days ?? 30),
        redDays: Number(semaphore.red_days ?? 15),
        labelGreen: semaphore.label_green,
        labelYellow: semaphore.label_yellow,
        labelOrange: semaphore.label_orange,
        labelRed: semaphore.label_red,
      });
      const nearest = nf
        ? {
            due: nf.forecast_due_date ? new Date(nf.forecast_due_date) : null,
            label:
              nf.risk_level === "red"
                ? semaphore.label_red
                : nf.risk_level === "orange"
                  ? semaphore.label_orange
                  : nf.risk_level === "yellow"
                    ? semaphore.label_yellow
                    : nf.risk_level === "green"
                      ? semaphore.label_green
                      : "Sin info",
            typeName: nf.deadline_name ?? "Sin tipo",
            measureBy: nf.measure_by,
          }
        : computedNearest;
      const status: Status = nf?.risk_level ?? ((computedNearest?.status as Status) ?? "none");
      return { entity: e, nearest, status, latestUsage: latest, latestUsageAt: latestAt };
    });
  }, [entities, usage, semaphore]);

  const countsAll = useMemo(() => {
    let red = 0;
    let orange = 0;
    let yellow = 0;
    let green = 0;
    let none = 0;

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
      if (sortMode === "critical") {
        const pa = statusPriority(a.status);
        const pb = statusPriority(b.status);
        if (pa !== pb) return pa - pb;

        const da = a.nearest?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const db = b.nearest?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;

        return a.entity.name.localeCompare(b.entity.name);
      }

      if (sortMode === "name") return a.entity.name.localeCompare(b.entity.name);
      if (sortMode === "type") return (a.entity.entity_types?.name ?? "").localeCompare(b.entity.entity_types?.name ?? "");
      return new Date(b.entity.created_at).getTime() - new Date(a.entity.created_at).getTime();
    });

    return out;
  }, [computedAll, filterEntityType, filterStatus, q, sortMode]);

  useEffect(() => {
    setPage(1);
  }, [filterEntityType, filterStatus, q, sortMode, pageSize]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(pageStart, pageStart + pageSize);
  const hasActiveFilters = q.trim().length > 0 || filterEntityType !== "all" || filterStatus !== "all" || sortMode !== "critical";

  function countByStatus(s: Status | "all") {
    if (s === "all") return countsAll.total;
    if (s === "red") return countsAll.red;
    if (s === "orange") return countsAll.orange;
    if (s === "yellow") return countsAll.yellow;
    if (s === "green") return countsAll.green;
    return countsAll.none;
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-5 px-4 py-4 sm:space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="app-page-title">Entidades</CardTitle>
              <p className="app-page-subtitle">Gestión compacta para alta densidad de registros.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowCreate(true)}
                size="sm"
                disabled={typesLoading}
                className="border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                + Entidad
              </Button>
              <Button
                onClick={() => {
                  setImportOpen(true);
                  setImportResult("");
                  setImportCsvText("");
                  setImportCanApply(false);
                  setImportProgress(0);
                  setImportStage("");
                  setImportMode("update");
                  setBulkPanel("import");
                  setBulkEntityTypeId("all");
                }}
                variant="outline"
                size="sm"
              >
                Carga masiva
              </Button>
              <Link href="/app">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <Button onClick={load} variant="outline" size="sm" disabled={loading}>
                Refrescar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <div className="app-alert app-alert-error whitespace-pre-wrap">{errorMsg}</div> : null}
      {flashMsg ? <div className="app-alert app-alert-success whitespace-pre-wrap">{flashMsg}</div> : null}

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="w-full max-w-[760px] rounded-2xl border bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Crear entidad</h3>
                <p className="mt-0.5 text-xs text-slate-500">Alta rápida y compacta.</p>
              </div>
              <Button onClick={() => setShowCreate(false)} variant="outline" size="sm" disabled={creating}>
                Cerrar
              </Button>
            </div>

            {typesLoading ? (
              <Loader label="Cargando tipos..." />
            ) : entityTypes.length === 0 ? (
              <div className="space-y-2 text-sm text-slate-600">
                <p>No hay tipos de entidad. Debes crear al menos uno antes de crear entidades.</p>
                <Link href="/app/entity-types">
                  <Button variant="outline" size="sm">Ir a Tipos de entidad</Button>
                </Link>
              </div>
            ) : (
              <form onSubmit={createEntityInline} className="grid gap-2">
                <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_220px_auto_auto] md:items-center">
                  <div className="grid gap-1">
                    <label htmlFor="entity_name" className="text-[11px] font-medium text-slate-500">Nombre</label>
                    <Input
                      id="entity_name"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      placeholder="Ej: Retroexcavadora 320D / Daniel Silva"
                      className="h-[var(--control-h)]"
                    />
                  </div>

                  <div className="grid gap-1">
                    <label htmlFor="entity_type" className="text-[11px] font-medium text-slate-500">Tipo</label>
                    <select
                      id="entity_type"
                      value={createEntityTypeId}
                      onChange={(e) => setCreateEntityTypeId(e.target.value)}
                      className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
                    >
                      {entityTypes.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="mt-1 flex min-h-[var(--control-h)] items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--border)] px-3 text-[13px] text-slate-700 md:mt-5 sm:text-sm">
                    <input
                      id="create_tracks_usage"
                      type="checkbox"
                      checked={createTracksUsage}
                      onChange={(e) => setCreateTracksUsage(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Con uso
                  </label>

                  <Button type="submit" size="sm" disabled={creating} className="min-h-[var(--control-h)] md:mt-5">
                    {creating ? "Creando..." : "Crear"}
                  </Button>
                </div>

                {createTracksUsage ? (
                  <div className="grid gap-1 md:max-w-[360px]">
                    <label htmlFor="entity_usage_unit" className="text-[11px] font-medium text-slate-500">Unidad de uso</label>
                    <select
                      id="entity_usage_unit"
                      value={createUsageUnitId}
                      onChange={(e) => setCreateUsageUnitId(e.target.value)}
                      disabled={usageUnits.length === 0}
                      className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm disabled:bg-slate-100"
                    >
                      <option value="">{usageUnits.length === 0 ? "Sin unidades activas" : "Sin unidad"}</option>
                      {usageUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    {usageUnits.length === 0 ? (
                      <p className="text-[11px] text-amber-700">
                        No hay unidades de uso activas para seleccionar.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <p className="text-[11px] text-slate-500">
                  Si activas <span className="font-medium">Con uso</span>, podrás asignar una unidad y registrar uso en esa métrica.
                </p>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
          <div className="max-h-[88vh] w-full max-w-[860px] overflow-y-auto rounded-2xl border bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Carga masiva de entidades</h3>
                <p className="mt-0.5 text-xs text-slate-500">Descarga, edita y vuelve a cargar con validación previa.</p>
              </div>
              <Button onClick={() => setImportOpen(false)} variant="outline" size="sm" disabled={importing}>
                Cerrar
              </Button>
            </div>

            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-slate-50 p-2">
                <Button
                  size="sm"
                  variant={bulkPanel === "export" ? "secondary" : "outline"}
                  onClick={() => setBulkPanel("export")}
                  disabled={importing}
                >
                  Exportar
                </Button>
                <Button
                  size="sm"
                  variant={bulkPanel === "import" ? "secondary" : "outline"}
                  onClick={() => setBulkPanel("import")}
                  disabled={importing}
                >
                  Importar
                </Button>
              </div>

              <div className="rounded-xl border bg-slate-50 p-3">
                {bulkPanel === "import" ? (
                  <div className="grid gap-1">
                    <label className="text-xs font-semibold text-slate-700">Importación</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={importMode === "update" ? "secondary" : "outline"}
                        onClick={() => {
                          setImportMode("update");
                          setImportCanApply(false);
                          setImportProgress(0);
                          setImportStage("");
                        }}
                        disabled={importing}
                      >
                        Actualizar
                      </Button>
                      <Button
                        size="sm"
                        variant={importMode === "create" ? "secondary" : "outline"}
                        onClick={() => {
                          setImportMode("create");
                          setImportCanApply(false);
                          setImportProgress(0);
                          setImportStage("");
                        }}
                        disabled={importing}
                      >
                        Crear
                      </Button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {importMode === "update"
                        ? "Actualizar requiere entity_id en cada fila."
                        : "Crear ignora entity_id y genera nuevas entidades."}
                    </p>
                  </div>
                ) : null}
                <div className="mt-3 grid gap-1">
                  <label className="text-xs font-semibold text-slate-700">Tipo de entidad (opcional)</label>
                  <select
                    value={bulkEntityTypeId}
                    onChange={(e) => {
                      setBulkEntityTypeId(e.target.value);
                      setImportCanApply(false);
                      setImportProgress(0);
                      setImportStage("");
                    }}
                    className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
                    disabled={importing || typesLoading}
                  >
                    <option value="all">Todos los tipos</option>
                    {entityTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {bulkPanel === "export" ? (
                <div className="rounded-xl border p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-700">Descarga</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const params = new URLSearchParams();
                        if (bulkEntityTypeId !== "all") params.set("entity_type_id", bulkEntityTypeId);
                        params.set("mode", "update");
                        const q = `?${params.toString()}`;
                        void downloadExcelFromCsvEndpoint(
                          `/api/entities/bulk/template${q}`,
                          "entities_template_update.xlsx"
                        );
                      }}
                      disabled={importing}
                    >
                      Plantilla actualización
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const params = new URLSearchParams();
                        if (bulkEntityTypeId !== "all") params.set("entity_type_id", bulkEntityTypeId);
                        params.set("mode", "create");
                        const q = `?${params.toString()}`;
                        void downloadExcelFromCsvEndpoint(
                          `/api/entities/bulk/template${q}`,
                          "entities_template_create.xlsx"
                        );
                      }}
                      disabled={importing}
                    >
                      Plantilla altas
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const q = bulkEntityTypeId !== "all" ? `?entity_type_id=${encodeURIComponent(bulkEntityTypeId)}` : "";
                        void downloadExcelFromCsvEndpoint(`/api/entities/bulk/export${q}`, "entities_export.xlsx");
                      }}
                      disabled={importing}
                    >
                      Exportar entidades Excel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="relative rounded-xl border p-3">
                  {importApplying ? (
                    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/80 backdrop-blur-[1px]">
                      <div className="flex flex-col items-center gap-3">
                        <div className="relative h-28 w-28">
                          <svg viewBox="0 0 120 120" className="h-28 w-28">
                            <circle
                              cx="60"
                              cy="60"
                              r={importRingRadius}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="10"
                              className="text-slate-200"
                            />
                            <circle
                              cx="60"
                              cy="60"
                              r={importRingRadius}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="10"
                              strokeLinecap="round"
                              className="text-emerald-600 transition-all duration-300"
                              strokeDasharray={importRingCircumference}
                              strokeDashoffset={importRingCircumference * (1 - importProgressClamped / 100)}
                              transform="rotate(-90 60 60)"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-emerald-700">
                            {Math.round(importProgressClamped)}%
                          </div>
                        </div>
                        <p className="text-xs text-slate-600">{importStage || "Aplicando cambios..."}</p>
                      </div>
                    </div>
                  ) : null}
                  <div className="mb-2 text-xs font-semibold text-slate-700">Carga</div>
                  <label className="text-xs font-medium text-slate-600">Selecciona archivo</label>
                  <input
                    type="file"
                    accept=".csv,text/csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const lowerName = file.name.toLowerCase();
                      const buffer = await file.arrayBuffer();
                      setImportCanApply(false);
                      setImportProgress(20);
                      setImportStage("Procesando archivo...");

                      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
                        try {
                          const XLSX = await getXlsxModule();
                          const wb = XLSX.read(buffer, { type: "array" });
                          const firstSheet = wb.SheetNames[0];
                          if (!firstSheet) {
                            setImportCsvText("");
                            setImportResult("El archivo no contiene hojas para importar.");
                            setImportProgress(0);
                            setImportStage("");
                            return;
                          }
                          const ws = wb.Sheets[firstSheet];
                          const csv = XLSX.utils.sheet_to_csv(ws, { FS: ",", RS: "\n", blankrows: false });
                          setImportCsvText(csv);
                          setImportResult("");
                          await runImport(false, csv);
                          return;
                        } catch {
                          setImportCsvText("");
                          setImportResult("No se pudo leer el archivo Excel. Verifica que no esté dañado.");
                          setImportProgress(0);
                          setImportStage("");
                          return;
                        }
                      }

                      const text = new TextDecoder("utf-8").decode(new Uint8Array(buffer));
                      setImportCsvText(text);
                      setImportResult("");
                      await runImport(false, text);
                    }}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    disabled={importing}
                  />
                  {importProgress > 0 && !importApplying ? (
                    <div className="flex items-center gap-2 text-[11px] text-slate-500">
                      <span>{importStage || "Procesando"}</span>
                      <span>({Math.round(importProgressClamped)}%)</span>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-500">La validación se ejecuta automáticamente al cargar el archivo.</span>
                  </div>
                  {importResult ? (
                    <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-xs text-slate-700">{importResult}</pre>
                  ) : null}
                  {importCanApply ? (
                    <Button
                      onClick={() => void runImport(true)}
                      disabled={importing || !importCsvText.trim()}
                      className="w-fit bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      {importing ? "Procesando..." : "Aplicar cambios"}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
            <CardTitle className="shrink-0 text-base">Búsqueda y filtros</CardTitle>
            <div className="min-w-0 lg:flex-1">
              <div className="flex w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
                {statusFilterMeta.map((s) => (
                  <Button
                    key={s.key}
                    size="sm"
                    variant="outline"
                    onClick={() => setFilterStatus(s.key)}
                    className={cn("shrink-0", statusChipClasses(s.key, filterStatus === s.key))}
                    title={s.title}
                  >
                    <IconStatus status={s.key} />
                    <span className="hidden sm:inline">{s.title}</span>
                    <span>{countByStatus(s.key)}</span>
                  </Button>
                ))}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSearchPanelCollapsed((v) => !v)}
              className="min-h-[var(--control-h)] min-w-[108px] shrink-0 justify-between"
            >
              <span>{searchPanelCollapsed ? "Buscar" : "Ocultar"}</span>
              <span className="text-xs">{searchPanelCollapsed ? "▼" : "▲"}</span>
            </Button>
          </div>
          <div className="pt-1 text-xs text-slate-500">{rows.length} resultado(s)</div>
        </CardHeader>
        {!searchPanelCollapsed ? (
          <CardContent className="pt-0">
            <div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_190px_170px_140px_auto]">
              <Input
                id="entities_search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por entidad, tipo o vencimiento..."
              />
              <select
                id="entities_type_filter"
                aria-label="Filtrar por tipo"
                value={filterEntityType}
                onChange={(e) => setFilterEntityType(e.target.value)}
                className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
              >
                <option value="all">Todos los tipos</option>
                {entityTypeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
              <select
                id="entities_sort_mode"
                aria-label="Ordenar"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
              >
                <option value="critical">Más crítico</option>
                <option value="name">Nombre</option>
                <option value="type">Tipo</option>
                <option value="created">Creación</option>
              </select>
              <select
                id="entities_page_size"
                aria-label="Filas por página"
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="h-[var(--control-h)] rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 text-[13px] sm:text-sm"
              >
                <option value="25">25 / pág</option>
                <option value="50">50 / pág</option>
                <option value="100">100 / pág</option>
              </select>
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setFilterEntityType("all");
                  setFilterStatus("all");
                  setSortMode("critical");
                }}
                disabled={!hasActiveFilters}
              >
                Limpiar
              </Button>
            </div>
          </CardContent>
        ) : null}
      </Card>

      <section className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader label="Cargando entidades..." />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="pt-6">
              <p className="app-empty">No hay entidades para mostrar con estos filtros.</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border bg-white">
              <div className="grid min-w-[780px] grid-cols-[1.4fr_0.85fr_1.6fr_0.7fr] border-b bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                <div>Entidad</div>
                <div>Estado</div>
                <div>Más próximo</div>
                <div className="text-right">Uso</div>
              </div>
              {pagedRows.map((r) => {
                const e = r.entity;
                const nearest = r.nearest;
                const measureLabel = nearest?.measureBy === "usage" ? "por uso" : nearest?.measureBy === "date" ? "por fecha" : "sin dato";
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
                    className="grid min-w-[780px] cursor-pointer grid-cols-[1.4fr_0.85fr_1.6fr_0.7fr] items-center border-b px-3 py-2 text-[13px] transition-colors hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-slate-900">{e.name}</div>
                      <div className="truncate text-[11px] text-slate-500">{e.entity_types?.name ?? "Sin tipo"}</div>
                    </div>
                    <div>
                      <Badge variant="outline" className={cn("font-semibold", statusBadgeClasses(r.status))}>
                        {nearest?.label ?? "Sin info"}
                      </Badge>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-slate-900">
                        {nearest?.typeName ?? "—"}
                        {nearest?.due ? ` · ${fmtDate(nearest.due)}` : ""}
                      </div>
                      <div className="truncate text-[11px] text-slate-500">{measureLabel}</div>
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
