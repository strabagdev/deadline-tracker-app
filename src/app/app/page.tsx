"use client";

import { useEffect, useMemo, useState } from "react";
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

type Status = "green" | "yellow" | "red" | "none";

function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

function parseISODateOnly(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function computeDeadline(d: Deadline, latestUsage: number | null): { due: Date | null; status: Status; label: string } {
  const t = d.deadline_types;
  if (!t) return { due: null, status: "none", label: "Sin tipo" };

  const today = new Date();
  const warnDays = 7;

  if (t.measure_by === "date") {
    if (!d.next_due_date) return { due: null, status: "none", label: "Sin fecha" };
    const due = parseISODateOnly(d.next_due_date);
    const diff = daysBetween(today, due);
    if (diff < 0) return { due, status: "red", label: "Vencido" };
    if (diff <= warnDays) return { due, status: "yellow", label: "Por vencer" };
    return { due, status: "green", label: "Vigente" };
  }

  if (
    d.last_done_usage == null ||
    d.frequency == null ||
    d.usage_daily_average == null ||
    latestUsage == null ||
    d.usage_daily_average <= 0
  ) {
    return { due: null, status: "none", label: "Incompleto" };
  }

  const remaining = d.frequency - (latestUsage - d.last_done_usage);
  if (remaining <= 0) return { due: today, status: "red", label: "Vencido" };

  const days = remaining / d.usage_daily_average;
  const due = new Date(today.getTime() + days * 86400000);

  if (days <= warnDays) return { due, status: "yellow", label: "Por vencer" };
  return { due, status: "green", label: "Vigente" };
}

function statusStyle(s: Status): React.CSSProperties {
  const base = {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    border: "1px solid #ddd",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } as const;

  if (s === "red") return { ...base, background: "#ffeaea" };
  if (s === "yellow") return { ...base, background: "#fff6d8" };
  if (s === "green") return { ...base, background: "#e9ffe9" };
  return { ...base, opacity: 0.6 };
}

export default function AppDashboard() {
  const router = useRouter();

  const [entities, setEntities] = useState<EntityRow[]>([]);
  const [usage, setUsage] = useState<LatestUsageByEntity>({});
  const [meta, setMeta] = useState<DashboardMeta | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

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

  const rows = useMemo(() => {
    return entities.map((e) => {
      const latest = usage[e.id]?.value ?? null;

      let best: { due: Date | null; status: Status; label: string; typeName: string } | null = null;

      for (const d of e.deadlines ?? []) {
        if (d.deadline_types?.is_active === false) continue;
        const r = computeDeadline(d, latest);
        const typeName = d.deadline_types?.name ?? "—";

        if (!best) {
          best = { ...r, typeName };
          continue;
        }

        if (best.due == null && r.due != null) best = { ...r, typeName };
        else if (best.due != null && r.due != null && r.due < best.due) best = { ...r, typeName };
      }

      const status = best?.status ?? "none";
      return { entity: e, best, status, latestUsage: latest };
    });
  }, [entities, usage]);

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Dashboard</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>Resumen por entidad (vencimiento más próximo).</p>
        </div>
        <button onClick={load} style={{ padding: 10 }} disabled={loading}>
          Refrescar
        </button>
      </div>

      {errorMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{errorMsg}</p>}

      {loading ? (
        <p style={{ marginTop: 12 }}>Cargando…</p>
      ) : rows.length === 0 ? (
        <div style={{ marginTop: 12 }}>
          <p>No hay entidades para mostrar.</p>

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
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {rows.map(({ entity, best, status, latestUsage }) => (
            <div
              key={entity.id}
              style={{ border: "1px solid #ddd", borderRadius: 12, padding: 14, cursor: "pointer", background: "white" }}
              onClick={() => router.push(`/app/entities/${entity.id}`)}
              title="Abrir ficha"
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>{entity.name}</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>{entity.entity_types?.name ?? "Sin tipo"}</div>
                </div>

                <span style={statusStyle(status)}>
                  {status === "red" ? "🔴" : status === "yellow" ? "🟡" : status === "green" ? "🟢" : "⚪"}{" "}
                  {status === "red" ? "Vencido" : status === "yellow" ? "Por vencer" : status === "green" ? "Vigente" : "Sin info"}
                </span>
              </div>

              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 240px", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Más próximo</div>
                  <div style={{ fontWeight: 800 }}>
                    {best?.typeName ?? "—"}
                    {best?.due ? <span style={{ fontWeight: 600, opacity: 0.8 }}> · {best.due.toLocaleDateString()}</span> : null}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Uso actual</div>
                  <div style={{ fontWeight: 800 }}>{latestUsage ?? "—"}</div>
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    {usage[entity.id]?.logged_at ? new Date(usage[entity.id].logged_at).toLocaleString() : ""}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}