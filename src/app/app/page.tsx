"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

type EntityType = { id: string; name: string };

type EntityRow = {
  id: string;
  name: string;
  created_at: string;
  entity_type_id: string;
  entity_types?: EntityType | null;
  deadlines?: Deadline[] | null;
};

type LatestUsageByEntity = Record<string, { value: number; logged_at: string }>;

type DashboardMeta = {
  active_org_id: string;
  role: string;
  entity_count_in_org: number;
};

type Status = "red" | "orange" | "yellow" | "green" | "none";

type SemaphoreSettings = {
  date_yellow_days: number;
  date_orange_days: number;
  date_red_days: number;
  usage_yellow_days: number;
  usage_orange_days: number;
  usage_red_days: number;
};

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function parseISODateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ✅ ESTA ES LA REGLA FINAL (4 estados + vencido)
function classify(diffDays: number, yellow: number, orange: number, red: number) {
  if (diffDays <= 0) return { status: "red" as const, label: "Vencido" };
  if (diffDays <= red) return { status: "red" as const, label: "Crítico" };
  if (diffDays <= orange) return { status: "orange" as const, label: "Por vencer" };
  if (diffDays <= yellow) return { status: "yellow" as const, label: "Por vencer" };
  return { status: "green" as const, label: "Vigente" };
}

function computeStatusAndDue(
  deadline: Deadline,
  latestUsage: number | null,
  settings: SemaphoreSettings
): { due: Date | null; status: Status; label: string; typeName: string; measureBy: "date" | "usage" | "unknown" } {
  const t = deadline.deadline_types;
  const typeName = t?.name ?? "—";
  const measureBy: "date" | "usage" | "unknown" =
    t?.measure_by === "date" || t?.measure_by === "usage" ? t.measure_by : "unknown";
  if (!t) return { due: null, status: "none", label: "Sin tipo", typeName, measureBy };

  const today = new Date();

  if (t.measure_by === "date") {
    if (!deadline.next_due_date) return { due: null, status: "none", label: "Sin fecha", typeName, measureBy: "date" };
    const due = parseISODateOnly(deadline.next_due_date);
    const diff = daysBetween(today, due);

    const c = classify(
      diff,
      Number(settings.date_yellow_days ?? 60),
      Number(settings.date_orange_days ?? 30),
      Number(settings.date_red_days ?? 15)
    );

    return { due, status: c.status, label: c.label, typeName, measureBy: "date" };
  }

  // USO: días estimados restantes
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
  const avg = Number(deadline.usage_daily_average);

  if (remaining <= 0) return { due: today, status: "red", label: "Vencido", typeName, measureBy: "usage" };

  const days = remaining / avg;
  const due = new Date(today.getTime() + days * 86400000);

  const c = classify(
    days,
    Number(settings.usage_yellow_days ?? 60),
    Number(settings.usage_orange_days ?? 30),
    Number(settings.usage_red_days ?? 15)
  );

  return { due, status: c.status, label: c.label, typeName, measureBy: "usage" };
}

function pickNearestDeadline(entity: EntityRow, latestUsage: number | null, settings: SemaphoreSettings) {
  const ds = (entity.deadlines ?? []).filter((d) => d.deadline_types?.is_active !== false);

  let best: ReturnType<typeof computeStatusAndDue> | null = null;

  for (const d of ds) {
    const r = computeStatusAndDue(d, latestUsage, settings);
    if (!best) {
      best = r;
      continue;
    }
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
  if (s === "orange") return 1;
  if (s === "yellow") return 2;
  if (s === "green") return 3;
  return 4;
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
    orange: { background: "#fff0e6", borderColor: "#ffd7bf" },
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

function statusTone(s: Status): { border: string; soft: string; strong: string } {
  if (s === "red") return { border: "#f5c2c2", soft: "#fff2f2", strong: "#c72b2b" };
  if (s === "orange") return { border: "#ffd4b8", soft: "#fff5ee", strong: "#cc5a1c" };
  if (s === "yellow") return { border: "#ffe39c", soft: "#fff9e8", strong: "#9b7300" };
  if (s === "green") return { border: "#c7ebc7", soft: "#f1fff1", strong: "#2f7a2f" };
  return { border: "#e5e5e5", soft: "#fafafa", strong: "#666" };
}

export default function AppDashboard() {
  const router = useRouter();

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [meta, setMeta] = useState<DashboardMeta | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [semaphore, setSemaphore] = useState<SemaphoreSettings>({
    date_yellow_days: 60,
    date_orange_days: 30,
    date_red_days: 15,
    usage_yellow_days: 60,
    usage_orange_days: 30,
    usage_red_days: 15,
  });

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
      setErrorMsg(json.error || "No se pudo cargar el dashboard");
      setEntities([]);
      setUsage({});
      setMeta(null);
      setLoading(false);
      return;
    }

    setMeta(json.meta ?? null);
    setEntities(json.entities ?? []);
    setUsage(json.latest_usage_by_entity ?? {});

    // settings semáforo
    const sres = await fetch("/api/settings/semaphore", { headers: { Authorization: `Bearer ${token}` } });
    const sjson = await sres.json().catch(() => ({}));
    if (sres.ok && sjson?.settings) {
      setSemaphore({
        date_yellow_days: Number(sjson.settings.date_yellow_days ?? 60),
        date_orange_days: Number(sjson.settings.date_orange_days ?? 30),
        date_red_days: Number(sjson.settings.date_red_days ?? 15),
        usage_yellow_days: Number(sjson.settings.usage_yellow_days ?? 60),
        usage_orange_days: Number(sjson.settings.usage_orange_days ?? 30),
        usage_red_days: Number(sjson.settings.usage_red_days ?? 15),
      });
    }

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

  const computedAll = useMemo(() => {
    return entities.map((e) => {
      const latest = usage[e.id]?.value ?? null;
      const latestAt = usage[e.id]?.logged_at ?? null;
      const nearest = pickNearestDeadline(e, latest, semaphore);
      const status: Status = (nearest?.status as Status) ?? "none";
      return { entity: e, latestUsage: latest, latestUsageAt: latestAt, nearest, status };
    });
  }, [entities, usage, semaphore]);

  const countsAll = useMemo(() => {
    let red = 0,
      orange = 0,
      yellow = 0,
      green = 0,
      none = 0;

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
      if (needle && !r.entity.name.toLowerCase().includes(needle)) return false;
      return true;
    });

    out.sort((a, b) => {
      const pa = statusPriority(a.status);
      const pb = statusPriority(b.status);
      if (pa !== pb) return pa - pb;

      const da = a.nearest?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const db = b.nearest?.due?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;

      return a.entity.name.localeCompare(b.entity.name);
    });

    return out;
  }, [computedAll, filterEntityType, filterStatus, q]);

  useEffect(() => {
    setPage(1);
  }, [filterEntityType, filterStatus, q, pageSize]);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pagedRows = rows.slice(pageStart, pageStart + pageSize);

  const hasEntities = (meta?.entity_count_in_org ?? entities.length) > 0;

  return (
    <main style={{ padding: 16, maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>
            Umbrales: 🟡≤{semaphore.date_yellow_days} · 🟠≤{semaphore.date_orange_days} · 🔴≤{semaphore.date_red_days} · vencido≤0
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/app/entities?new=1" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>+ Nueva entidad</button>
          </Link>

          <Link href="/app/entities" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>Ver entidades</button>
          </Link>

          <Link href="/app/settings/semaphore" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>Semáforo</button>
          </Link>

          <button onClick={load} style={{ padding: "10px 12px" }} disabled={loading}>
            Refrescar
          </button>
        </div>
      </div>

      {errorMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{errorMsg}</p>}

      <section style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 16, padding: 12, background: "white" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 220px", gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, opacity: 0.7 }}>Buscar</label>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar entidad por nombre..."
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, opacity: 0.7 }}>Tipo</label>
              <select
                value={filterEntityType}
                onChange={(e) => setFilterEntityType(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
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
              <label style={{ fontSize: 12, opacity: 0.7 }}>Filas por página</label>
              <select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, opacity: 0.7, marginRight: 6 }}>Estado:</span>

          <span onClick={() => setFilterStatus("all")} style={statusChipStyle("all", filterStatus === "all")}>
            📌 Todos
          </span>
          <span onClick={() => setFilterStatus("red")} style={statusChipStyle("red", filterStatus === "red")}>
            🔴 Rojo
          </span>
          <span onClick={() => setFilterStatus("orange")} style={statusChipStyle("orange", filterStatus === "orange")}>
            🟠 Naranja
          </span>
          <span onClick={() => setFilterStatus("yellow")} style={statusChipStyle("yellow", filterStatus === "yellow")}>
            🟡 Amarillo
          </span>
          <span onClick={() => setFilterStatus("green")} style={statusChipStyle("green", filterStatus === "green")}>
            🟢 Verde
          </span>
          <span onClick={() => setFilterStatus("none")} style={statusChipStyle("none", filterStatus === "none")}>
            ⚪ Sin info
          </span>

          <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={badgeStyle()}>🔴 {countsAll.red}</span>
            <span style={badgeStyle()}>🟠 {countsAll.orange}</span>
            <span style={badgeStyle()}>🟡 {countsAll.yellow}</span>
            <span style={badgeStyle()}>🟢 {countsAll.green}</span>
            <span style={badgeStyle()}>⚪ {countsAll.none}</span>
          </span>
        </div>
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        {loading ? (
          <p>Cargando…</p>
        ) : rows.length === 0 ? (
          <div>
            {!hasEntities ? (
              <p style={{ opacity: 0.8 }}>Aún no hay entidades. Crea tu primera entidad para comenzar.</p>
            ) : (
              <p style={{ opacity: 0.8 }}>No hay entidades para mostrar con estos filtros.</p>
            )}
          </div>
        ) : (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
                gap: 10,
              }}
            >
              {pagedRows.map((r) => {
                const e = r.entity;
                const nearest = r.nearest;
                const tone = statusTone(r.status);
                const hasLatestUsage = r.latestUsage != null;
                const hasLatestUsageAt = Boolean(r.latestUsageAt);

                return (
                  <article
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
                    style={{
                      border: `1px solid ${tone.border}`,
                      background: tone.soft,
                      borderRadius: 14,
                      padding: 11,
                      minHeight: 156,
                      cursor: "pointer",
                      display: "grid",
                      alignContent: "space-between",
                      gap: 9,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
                    }}
                    title="Abrir ficha"
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 900,
                            fontSize: 15,
                            lineHeight: 1.2,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {e.name}
                        </div>
                        <div style={{ marginTop: 4, opacity: 0.78, fontSize: 12 }}>
                          {e.entity_types?.name ?? "Sin tipo"}
                        </div>
                      </div>
                      <span
                        style={{
                          ...statusChipStyle(r.status, true),
                          background: "white",
                          borderColor: tone.border,
                          color: tone.strong,
                          fontWeight: 700,
                        }}
                      >
                        {nearest?.label ?? "Sin info"}
                      </span>
                    </div>

                    <div
                      style={{
                        background: "white",
                        border: `1px solid ${tone.border}`,
                        borderRadius: 10,
                        padding: "8px 9px",
                      }}
                    >
                      <div style={{ fontSize: 11, opacity: 0.72 }}>Próximo vencimiento</div>
                      <div style={{ marginTop: 2, fontWeight: 900, fontSize: 14 }}>
                        {nearest?.due ? fmtDate(nearest.due) : "Sin fecha estimada"}
                      </div>
                      <div style={{ marginTop: 2, fontSize: 12, opacity: 0.82 }}>
                        {nearest?.typeName ?? "Sin tipo"}
                        {nearest?.measureBy === "usage"
                          ? " · por uso"
                          : nearest?.measureBy === "date"
                          ? " · por fecha"
                          : ""}
                      </div>
                    </div>

                    {(hasLatestUsage || hasLatestUsageAt) && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                        {hasLatestUsage && (
                          <div style={{ background: "white", border: "1px solid #ececec", borderRadius: 9, padding: "7px 8px" }}>
                            <div style={{ fontSize: 11, opacity: 0.68 }}>Uso actual</div>
                            <div style={{ marginTop: 2, fontWeight: 800 }}>{r.latestUsage}</div>
                          </div>
                        )}
                        {hasLatestUsageAt && (
                          <div style={{ background: "white", border: "1px solid #ececec", borderRadius: 9, padding: "7px 8px" }}>
                            <div style={{ fontSize: 11, opacity: 0.68 }}>Último registro</div>
                            <div style={{ marginTop: 2, fontWeight: 800 }}>
                              {new Date(r.latestUsageAt as string).toLocaleDateString()}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 4px 2px 4px" }}>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Mostrando {rows.length === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + pageSize, rows.length)} de {rows.length}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  style={{ padding: "8px 12px" }}
                >
                  Anterior
                </button>
                <div style={{ fontSize: 12, opacity: 0.8, alignSelf: "center" }}>
                  Página {safePage} de {totalPages}
                </div>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  style={{ padding: "8px 12px" }}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
