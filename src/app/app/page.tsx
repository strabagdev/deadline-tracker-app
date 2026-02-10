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

type DashboardMeta = {
  active_org_id: string;
  role: string;
  entity_count_in_org: number;
};

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


export default function AppDashboard() {
  const router = useRouter();

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [meta, setMeta] = useState<DashboardMeta | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [filterStatus, setFilterStatus] = useState<Status | "all">("all");
  const [filterEntityType, setFilterEntityType] = useState<string>("all");

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
    const out: Array<{
      entity: EntityRow;
      latestUsage: number | null;
      latestUsageAt: string | null;
      nearest: ReturnType<typeof pickNearestDeadline>;
      status: Status;
    }> = [];

    for (const e of entities) {
      if (filterEntityType !== "all" && e.entity_type_id !== filterEntityType) continue;

      const latest = usage[e.id]?.value ?? null;
      const latestAt = usage[e.id]?.logged_at ?? null;
      const nearest = pickNearestDeadline(e, latest, 7);
      const status: Status = (nearest?.status as Status) ?? "none";

      if (filterStatus !== "all" && status !== filterStatus) continue;

      out.push({ entity: e, latestUsage: latest, latestUsageAt: latestAt, nearest, status });
    }

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
  }, [entities, usage, filterEntityType, filterStatus]);

  const counts = useMemo(() => {
    let red = 0,
      yellow = 0,
      green = 0,
      none = 0;
    for (const r of rows) {
      if (r.status === "red") red++;
      else if (r.status === "yellow") yellow++;
      else if (r.status === "green") green++;
      else none++;
    }
    return { red, yellow, green, none, total: rows.length };
  }, [rows]);

  const headerStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  };

  const cardStyle: React.CSSProperties = {
    border: "1px solid #eee",
    borderRadius: 16,
    padding: 14,
    background: "white",
    cursor: "pointer",
  };

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={headerStyle}>
        <div>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>Ordenado por criticidad (vencidos → por vencer → vigentes).</p>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/app/entities?new=1" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>+ Nueva entidad</button>
          </Link>

          <Link href="/app/entities" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>Ver entidades</button>
          </Link>

          <button onClick={load} style={{ padding: "10px 12px" }} disabled={loading}>
            Refrescar
          </button>
        </div>
      </div>

      {errorMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{errorMsg}</p>}

      <section style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 16, padding: 12, background: "white" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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

          <span style={{ marginLeft: 10, fontSize: 12, opacity: 0.7 }}>Tipo:</span>
          <select
            value={filterEntityType}
            onChange={(e) => setFilterEntityType(e.target.value)}
            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #e5e5e5" }}
          >
            <option value="all">Todos</option>
            {entityTypeOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={badgeStyle()}>🔴 {counts.red}</span>
            <span style={badgeStyle()}>🟡 {counts.yellow}</span>
            <span style={badgeStyle()}>🟢 {counts.green}</span>
            <span style={badgeStyle()}>⚪ {counts.none}</span>
          </span>
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        {loading ? (
          <p>Cargando…</p>
        ) : rows.length === 0 ? (
          <div>
            <p style={{ opacity: 0.8 }}>No hay entidades para mostrar con estos filtros.</p>

            {meta ? (
              <div style={{ fontSize: 12, opacity: 0.85, border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Diagnóstico</div>
                <div>active_org_id: {meta.active_org_id}</div>
                <div>role: {meta.role}</div>
                <div>entity_count_in_org: {meta.entity_count_in_org}</div>
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {rows.map((r) => {
              const e = r.entity;
              const nearest = r.nearest;
              const measure =
                nearest?.measureBy === "usage" ? "por uso (estimado)" : nearest?.measureBy === "date" ? "por fecha" : "—";

              return (
                <div key={e.id} style={cardStyle} onClick={() => router.push(`/app/entities/${e.id}`)} title="Abrir ficha">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.name}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{e.entity_types?.name ?? "Sin tipo"}</div>
                    </div>

                    <span style={statusChipStyle(r.status, true)}>
                      {r.status === "red" ? "🔴" : r.status === "yellow" ? "🟡" : r.status === "green" ? "🟢" : "⚪"}{" "}
                      {nearest?.label ?? "Sin info"}
                    </span>
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 240px", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Más próximo</div>
                      <div style={{ fontWeight: 900 }}>
                        {nearest?.typeName ?? "—"}{" "}
                        {nearest?.due ? <span style={{ fontWeight: 700, opacity: 0.85 }}>· {fmtDate(nearest.due)}</span> : null}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{measure}</div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Uso actual</div>
                      <div style={{ fontWeight: 900 }}>{r.latestUsage != null ? r.latestUsage : "—"}</div>
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                        {r.latestUsageAt ? new Date(r.latestUsageAt).toLocaleString() : ""}
                      </div>
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
