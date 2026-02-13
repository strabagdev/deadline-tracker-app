"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

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
  entity_types?: EntityType | null;
  deadlines?: Deadline[] | null;
};

type LatestUsageByEntity = Record<string, { value: number; logged_at: string }>;

type Status = "red" | "yellow" | "green" | "none";

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function parseISODateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function computeStatusAndDue(
  deadline: Deadline,
  latestUsage: number | null,
  warnDays = 7
): { due: Date | null; status: Status; label: string; typeName: string; measureBy: "date" | "usage" | "unknown" } {
  const t = deadline.deadline_types;
  const typeName = t?.name ?? "—";
  const measureBy = (t?.measure_by as any) ?? "unknown";

  if (!t) return { due: null, status: "none", label: "Sin tipo", typeName, measureBy };

  const today = new Date();

  if (t.measure_by === "date") {
    if (!deadline.next_due_date) return { due: null, status: "none", label: "Sin fecha", typeName, measureBy: "date" };
    const due = parseISODateOnly(deadline.next_due_date);
    const diff = daysBetween(today, due);
    if (diff < 0) return { due, status: "red", label: "Vencido", typeName, measureBy: "date" };
    if (diff <= warnDays) return { due, status: "yellow", label: "Por vencer", typeName, measureBy: "date" };
    return { due, status: "green", label: "Vigente", typeName, measureBy: "date" };
  }

  // usage
  if (
    deadline.last_done_usage == null ||
    deadline.frequency == null ||
    deadline.usage_daily_average == null ||
    latestUsage == null ||
    Number(deadline.usage_daily_average) <= 0
  ) {
    return { due: null, status: "none", label: "Incompleto", typeName, measureBy: "usage" };
  }

  const remaining = Number(deadline.frequency) - (Number(latestUsage) - Number(deadline.last_done_usage));
  if (remaining <= 0) return { due: today, status: "red", label: "Vencido", typeName, measureBy: "usage" };

  const days = remaining / Number(deadline.usage_daily_average);
  const due = new Date(today.getTime() + days * 86400000);

  if (days <= warnDays) return { due, status: "yellow", label: "Por vencer", typeName, measureBy: "usage" };
  return { due, status: "green", label: "Vigente", typeName, measureBy: "usage" };
}

function pickNearestDeadline(entity: EntityRow, latestUsage: number | null, warnDays = 7) {
  const ds = (entity.deadlines ?? []).filter((d) => d.deadline_types?.is_active !== false);

  let best: ReturnType<typeof computeStatusAndDue> | null = null;

  for (const d of ds) {
    const r = computeStatusAndDue(d, latestUsage, warnDays);
    if (!best) {
      best = r;
      continue;
    }

    // earliest due (nulls last)
    if (best.due == null && r.due != null) best = r;
    else if (best.due != null && r.due != null && r.due < best.due) best = r;
  }

  return best;
}

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return d.toLocaleDateString();
}

function statusPriority(s: Status) {
  if (s === "red") return 0;
  if (s === "yellow") return 1;
  if (s === "green") return 2;
  return 3;
}

function statusChipStyle(s: Status | "all", active: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    border: "1px solid #e5e5e5",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    cursor: "pointer",
    background: "white",
    userSelect: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  const map: Record<string, React.CSSProperties> = {
    red: { background: "#ffeaea", borderColor: "#ffd0d0" },
    yellow: { background: "#fff6d8", borderColor: "#ffe7a6" },
    green: { background: "#e9ffe9", borderColor: "#cfffcc" },
    none: { background: "#f6f6f6", borderColor: "#e7e7e7" },
    all: { background: "#f3f7ff", borderColor: "#d7e6ff" },
  };

  const act: React.CSSProperties = active ? { boxShadow: "0 0 0 2px rgba(0,0,0,0.06)" } : { opacity: 0.85 };
  return { ...base, ...(map[s] ?? {}), ...act };
}

function badgeStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid #eee",
    background: "white",
    opacity: 0.9,
  };
}


type SortMode = "critical" | "name" | "type" | "created";

export default function EntitiesPage() {
  const router = useRouter();

  const searchParams = useSearchParams();
  const autoOpenCreate = searchParams.get("new") === "1";

  const [showCreate, setShowCreate] = useState<boolean>(autoOpenCreate);

  const [createName, setCreateName] = useState<string>("");
  const [createEntityTypeId, setCreateEntityTypeId] = useState<string>("");
  // If true, this entity will record usage logs (hours/km/etc.) and can have usage-based deadlines
  const [createTracksUsage, setCreateTracksUsage] = useState<boolean>(false);

  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [typesLoading, setTypesLoading] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);

  // Load entity types for the inline create form (single source of truth: /api/entity-types)
  useEffect(() => {
    void loadEntityTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEntityTypes() {
    setTypesLoading(true);

    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      router.replace("/login");
      return;
    }

    const res = await fetch("/api/entity-types", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const list = (json.entity_types ?? json.data ?? json ?? []) as EntityType[];
      const safe = Array.isArray(list) ? list : [];
      setEntityTypes(safe);
      // default selection
      if (!createEntityTypeId && safe[0]?.id) setCreateEntityTypeId(safe[0].id);
    }

    setTypesLoading(false);
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
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo crear la entidad.");
      setCreating(false);
      return;
    }

    // clear + refresh
    setCreateName("");
    setCreateTracksUsage(false);
    setShowCreate(false);

    const id = json.entity?.id || json.id;
    if (id) {
      router.push(`/app/entities/${id}`);
    } else {
      await load();
    }

    setCreating(false);
  }


  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [sortMode, setSortMode] = useState<SortMode>("critical");

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setErrorMsg(json.error || "No se pudo cargar entidades");
      setEntities([]);
      setUsage({});
      setLoading(false);
      return;
    }

    setEntities(json.entities ?? []);
    setUsage(json.latest_usage_by_entity ?? {});
    setLoading(false);
  }

  const entityTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entities) {
      const t = e.entity_types;
      if (t?.id) map.set(t.id, t.name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entities]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();

    const out = entities
      .map((e) => {
        const latest = usage[e.id]?.value ?? null;
        const latestAt = usage[e.id]?.logged_at ?? null;
        const nearest = pickNearestDeadline(e, latest, 7);
        const status: Status = (nearest?.status as Status) ?? "none";
        return { entity: e, nearest, status, latestUsage: latest, latestUsageAt: latestAt };
      })
      .filter((r) => {
        if (filterEntityType !== "all" && r.entity.entity_type_id !== filterEntityType) return false;
        if (filterStatus !== "all" && r.status !== filterStatus) return false;
        if (needle && !r.entity.name.toLowerCase().includes(needle)) return false;
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
  }, [entities, usage, q, filterStatus, filterEntityType, sortMode]);

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Entidades</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>Lista para gestión: buscar, filtrar y abrir ficha.</p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>

          <Link href="/app" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>Volver al dashboard</button>
          </Link>

          <button onClick={load} style={{ padding: "10px 12px" }} disabled={loading}>
            Refrescar
          </button>
        </div>
      </div>

      
      {errorMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{errorMsg}</p>}

      {/* Create entity (single place) */}
      <section
        style={{
          marginTop: 12,
          border: "1px solid #eee",
          borderRadius: 16,
          padding: 12,
          background: "white",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 900 }}>Crear entidad</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
              Este es el único lugar para crear entidades (evita duplicidad).
            </div>
          </div>

          <button
            onClick={() => setShowCreate((v) => !v)}
            style={{ padding: "10px 12px" }}
            disabled={typesLoading}
          >
            {showCreate ? "Cerrar" : "+ Nueva entidad"}
          </button>
        </div>

        {showCreate ? (
          <div style={{ marginTop: 12 }}>
            {typesLoading ? (
              <p>Cargando tipos…</p>
            ) : entityTypes.length === 0 ? (
              <div style={{ opacity: 0.85 }}>
                <p>No hay tipos de entidad. Debes crear al menos uno antes de crear entidades.</p>
                <Link href="/app/entity-types" style={{ textDecoration: "none" }}>
                  <button style={{ padding: "10px 12px" }}>Ir a Tipos de entidad</button>
                </Link>
              </div>
            ) : (
              <form onSubmit={createEntityInline} style={{ display: "grid", gap: 10, maxWidth: 640 }}>
                <div>
                  <label style={{ fontSize: 12, opacity: 0.7 }}>Nombre</label>
                  <input
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Ej: Retroexcavadora 320D / Daniel Silva"
                    style={{
                      width: "100%",
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #e5e5e5",
                      marginTop: 6,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, opacity: 0.7 }}>Tipo de entidad</label>
                  <select
                    value={createEntityTypeId}
                    onChange={(e) => setCreateEntityTypeId(e.target.value)}
                    style={{
                      width: "100%",
                      padding: 10,
                      borderRadius: 10,
                      border: "1px solid #e5e5e5",
                      marginTop: 6,
                    }}
                  >
                    {entityTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid #eee", borderRadius: 12 }}>
                  <input
                    id="create_tracks_usage"
                    type="checkbox"
                    checked={createTracksUsage}
                    onChange={(e) => setCreateTracksUsage(e.target.checked)}
                    style={{ width: 16, height: 16 }}
                  />
                  <label htmlFor="create_tracks_usage" style={{ fontSize: 13 }}>
                    Registra uso (usage logs) — habilita vencimientos por uso (horas/km)
                  </label>
                </div>

                <button type="submit" disabled={creating} style={{ padding: "10px 12px", width: "fit-content" }}>
                  {creating ? "Creando…" : "Crear"}
                </button>
              </form>
            )}
          </div>
        ) : null}
      </section>


      <section style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 16, padding: 12, background: "white" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 160px", gap: 10, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 12, opacity: 0.7 }}>Buscar</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre de entidad…"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, opacity: 0.7 }}>Tipo</label>
              <select
                value={filterEntityType}
                onChange={(e) => setFilterEntityType(e.target.value)}
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
              >
                <option value="all">Todos</option>
                {entityTypeOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, opacity: 0.7 }}>Orden</label>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
              >
                <option value="critical">Más crítico</option>
                <option value="name">Nombre</option>
                <option value="type">Tipo</option>
                <option value="created">Creación (reciente)</option>
              </select>
            </div>
          </div>

          <button
            onClick={() => {
              setQ("");
              setFilterEntityType("all");
              setFilterStatus("all");
              setSortMode("critical");
            }}
            style={{ padding: 10 }}
          >
            Limpiar
          </button>
        </div>

        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.7, marginRight: 6 }}>Estado:</span>
          <span onClick={() => setFilterStatus("all")} style={statusChipStyle("all", filterStatus === "all")}>
            📌 Todos
          </span>
          <span onClick={() => setFilterStatus("red")} style={statusChipStyle("red", filterStatus === "red")}>
            🔴 Vencido
          </span>
          <span onClick={() => setFilterStatus("yellow")} style={statusChipStyle("yellow", filterStatus === "yellow")}>
            🟡 Por vencer
          </span>
          <span onClick={() => setFilterStatus("green")} style={statusChipStyle("green", filterStatus === "green")}>
            🟢 Vigente
          </span>
          <span onClick={() => setFilterStatus("none")} style={statusChipStyle("none", filterStatus === "none")}>
            ⚪ Sin info
          </span>

          <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.75 }}>{rows.length} resultado(s)</span>
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        {loading ? (
          <p>Cargando…</p>
        ) : rows.length === 0 ? (
          <p style={{ opacity: 0.8 }}>No hay entidades para mostrar con estos filtros.</p>
        ) : (
          <div style={{ border: "1px solid #eee", borderRadius: 16, overflow: "hidden", background: "white" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr 0.8fr 1.6fr 0.8fr",
                gap: 0,
                padding: "10px 12px",
                borderBottom: "1px solid #eee",
                fontSize: 12,
                opacity: 0.75,
              }}
            >
              <div>Entidad</div>
              <div>Estado</div>
              <div>Más próximo</div>
              <div style={{ textAlign: "right" }}>Uso</div>
            </div>

            {rows.map((r) => {
              const e = r.entity;
              const nearest = r.nearest;
              const measure = nearest?.measureBy === "usage" ? "uso" : nearest?.measureBy === "date" ? "fecha" : "—";

              return (
                <div
                  key={e.id}
                  onClick={() => router.push(`/app/entities/${e.id}`)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 0.8fr 1.6fr 0.8fr",
                    gap: 0,
                    padding: "12px 12px",
                    borderBottom: "1px solid #f0f0f0",
                    cursor: "pointer",
                  }}
                  title="Abrir ficha"
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{e.entity_types?.name ?? "Sin tipo"}</div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center" }}>
                    <span style={statusChipStyle(r.status, true)}>
                      {r.status === "red" ? "🔴" : r.status === "yellow" ? "🟡" : r.status === "green" ? "🟢" : "⚪"}{" "}
                      {nearest?.label ?? "Sin info"}
                    </span>
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nearest?.typeName ?? "—"}{" "}
                      {nearest?.due ? <span style={{ fontWeight: 700, opacity: 0.85 }}>· {fmtDate(nearest.due)}</span> : null}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{measure}</div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 900 }}>{r.latestUsage != null ? r.latestUsage : "—"}</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      {r.latestUsageAt ? new Date(r.latestUsageAt).toLocaleDateString() : ""}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
