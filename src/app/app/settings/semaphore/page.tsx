"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

/**
 * Semáforo (umbral en días) aplicado a:
 * - Vencimientos por FECHA: days_remaining
 * - Vencimientos por USO: estimated_days (derivado de usage)
 *
 * NOTA: Este formulario edita UN SOLO set de umbrales persistido en
 * yellow_days, orange_days y red_days.
 */

type SettingsPayload = {
  organization_id?: string;
  role?: string;
  settings?: Partial<{
    yellow_days: number;
    orange_days: number;
    red_days: number;
    // legacy fallback
    date_yellow_days: number;
    date_orange_days: number;
    date_red_days: number;
    usage_yellow_days: number;
    usage_orange_days: number;
    usage_red_days: number;
  }>;
};

type UnifiedThresholds = {
  yellow_days: number;
  orange_days: number;
  red_days: number;
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
      yellow_days: Number(s.yellow_days ?? s.date_yellow_days ?? s.usage_yellow_days ?? 60),
      orange_days: Number(s.orange_days ?? s.date_orange_days ?? s.usage_orange_days ?? 30),
      red_days: Number(s.red_days ?? s.date_red_days ?? s.usage_red_days ?? 15),
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

    setOkMsg("Guardado ✅ (aplica para FECHA y USO)");
    setSaving(false);
  }

  const canEdit = role === "owner" || role === "admin";

  const helpText = useMemo(
    () =>
      "Estados: 🟢 verde, 🟡 amarillo, 🟠 naranja, 🔴 rojo. " +
      "Vencido cuando días ≤ 0. Estos umbrales se aplican a FECHA (días restantes) y USO (días estimados).",
    []
  );

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Semáforo</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>{helpText}</p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/app" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>Dashboard</button>
          </Link>
          <button onClick={load} style={{ padding: "10px 12px" }} disabled={loading || saving}>
            Actualizar
          </button>
        </div>
      </div>

      {errorMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{errorMsg}</p>}
      {okMsg && <p style={{ color: "green" }}>{okMsg}</p>}

      <section
        style={{
          marginTop: 12,
          border: "1px solid #eee",
          borderRadius: 16,
          padding: 12,
          background: "white",
        }}
      >
        {loading ? (
          <p>Cargando…</p>
        ) : (
          <>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Organización activa: <b>{orgId || "—"}</b> · Rol: <b>{role || "—"}</b>
            </div>

            {!canEdit ? <p style={{ marginTop: 10, opacity: 0.8 }}>Solo owner/admin puede editar.</p> : null}

            <form onSubmit={save} style={{ marginTop: 12, display: "grid", gap: 16, maxWidth: 620 }}>
              <div style={{ border: "1px solid #f0f0f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 900 }}>Umbrales (aplican a FECHA y USO)</div>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🟡 Yellow ≤ (días)
                    <input
                      disabled={!canEdit || saving}
                      value={String(t.yellow_days)}
                      onChange={(e) => setT((p) => ({ ...p, yellow_days: Number(e.target.value) }))}
                      inputMode="numeric"
                      style={{
                        width: "100%",
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #e5e5e5",
                        marginTop: 6,
                      }}
                    />
                  </label>

                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🟠 Orange ≤ (días)
                    <input
                      disabled={!canEdit || saving}
                      value={String(t.orange_days)}
                      onChange={(e) => setT((p) => ({ ...p, orange_days: Number(e.target.value) }))}
                      inputMode="numeric"
                      style={{
                        width: "100%",
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #e5e5e5",
                        marginTop: 6,
                      }}
                    />
                  </label>

                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🔴 Red ≤ (días)
                    <input
                      disabled={!canEdit || saving}
                      value={String(t.red_days)}
                      onChange={(e) => setT((p) => ({ ...p, red_days: Number(e.target.value) }))}
                      inputMode="numeric"
                      style={{
                        width: "100%",
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid #e5e5e5",
                        marginTop: 6,
                      }}
                    />
                  </label>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                  Vencido cuando días ≤ <b>0</b> (no editable).
                </div>
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button type="submit" disabled={!canEdit || saving} style={{ padding: "10px 14px", fontWeight: 800 }}>
                  {saving ? "Guardando…" : "Guardar"}
                </button>
                <button
                  type="button"
                  onClick={load}
                  disabled={loading || saving}
                  style={{ padding: "10px 14px", opacity: 0.85 }}
                >
                  Revertir
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
