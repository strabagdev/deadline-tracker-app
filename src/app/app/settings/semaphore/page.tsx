"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type Settings = {
  date_yellow_days: number;
  date_orange_days: number;
  date_red_days: number;
  usage_yellow_days: number;
  usage_orange_days: number;
  usage_red_days: number;
};

export default function SemaphoreSettingsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const [orgId, setOrgId] = useState<string>("");
  const [role, setRole] = useState<string>("");

  const [s, setS] = useState<Settings>({
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
    setOkMsg("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/settings/semaphore", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo cargar configuración");
      setLoading(false);
      return;
    }

    setOrgId(String(json.organization_id || ""));
    setRole(String(json.role || ""));

    const settings = json.settings || {};
    setS({
      date_yellow_days: Number(settings.date_yellow_days ?? 60),
      date_orange_days: Number(settings.date_orange_days ?? 30),
      date_red_days: Number(settings.date_red_days ?? 15),
      usage_yellow_days: Number(settings.usage_yellow_days ?? 60),
      usage_orange_days: Number(settings.usage_orange_days ?? 30),
      usage_red_days: Number(settings.usage_red_days ?? 15),
    });

    setLoading(false);
  }

  function setField<K extends keyof Settings>(k: K, v: number) {
    setS((prev) => ({ ...prev, [k]: v }));
  }

  function validateLocal(settings: Settings) {
    const chk = (y: number, o: number, r: number) => y >= o && o >= r && r >= 0;
    if (!chk(settings.date_yellow_days, settings.date_orange_days, settings.date_red_days)) {
      return "FECHA: debe ser yellow ≥ orange ≥ red (y red ≥ 0).";
    }
    if (!chk(settings.usage_yellow_days, settings.usage_orange_days, settings.usage_red_days)) {
      return "USO: debe ser yellow ≥ orange ≥ red (y red ≥ 0).";
    }
    return "";
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");
    setOkMsg("");

    const msg = validateLocal(s);
    if (msg) {
      setErrorMsg(msg);
      return;
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    setSaving(true);

    const res = await fetch("/api/settings/semaphore", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        ...s,
        date_yellow_days: Math.trunc(s.date_yellow_days),
        date_orange_days: Math.trunc(s.date_orange_days),
        date_red_days: Math.trunc(s.date_red_days),
        usage_yellow_days: Math.trunc(s.usage_yellow_days),
        usage_orange_days: Math.trunc(s.usage_orange_days),
        usage_red_days: Math.trunc(s.usage_red_days),
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json.error || "No se pudo guardar");
      setSaving(false);
      return;
    }

    setOkMsg("Guardado ✅");
    setSaving(false);
  }

  const canEdit = role === "owner" || role === "admin";

  return (
    <main style={{ padding: 16, maxWidth: 900, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Semáforo</h2>
          <p style={{ marginTop: 6, opacity: 0.75 }}>
            4 estados: 🟢 verde, 🟡 amarillo, 🟠 naranja, 🔴 rojo. (Vencido cuando días ≤ 0)
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/app" style={{ textDecoration: "none" }}>
            <button style={{ padding: "10px 12px" }}>Dashboard</button>
          </Link>
          <button onClick={load} style={{ padding: "10px 12px" }} disabled={loading}>
            Refrescar
          </button>
        </div>
      </div>

      {errorMsg && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{errorMsg}</p>}
      {okMsg && <p style={{ color: "green" }}>{okMsg}</p>}

      <section style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 16, padding: 12, background: "white" }}>
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
                <div style={{ fontWeight: 900 }}>Por FECHA (días restantes)</div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🟡 Yellow ≤
                    <input
                      disabled={!canEdit}
                      value={String(s.date_yellow_days)}
                      onChange={(e) => setField("date_yellow_days", Number(e.target.value))}
                      inputMode="numeric"
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
                    />
                  </label>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🟠 Orange ≤
                    <input
                      disabled={!canEdit}
                      value={String(s.date_orange_days)}
                      onChange={(e) => setField("date_orange_days", Number(e.target.value))}
                      inputMode="numeric"
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
                    />
                  </label>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🔴 Red ≤
                    <input
                      disabled={!canEdit}
                      value={String(s.date_red_days)}
                      onChange={(e) => setField("date_red_days", Number(e.target.value))}
                      inputMode="numeric"
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
                    />
                  </label>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
                  Nota: “vencido” siempre es ≤ 0 (no se edita). El umbral 🔴 es “crítico” (0 &lt; días ≤ red).
                </div>
              </div>

              <div style={{ border: "1px solid #f0f0f0", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 900 }}>Por USO (días estimados restantes)</div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr", marginTop: 10 }}>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🟡 Yellow ≤
                    <input
                      disabled={!canEdit}
                      value={String(s.usage_yellow_days)}
                      onChange={(e) => setField("usage_yellow_days", Number(e.target.value))}
                      inputMode="numeric"
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
                    />
                  </label>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🟠 Orange ≤
                    <input
                      disabled={!canEdit}
                      value={String(s.usage_orange_days)}
                      onChange={(e) => setField("usage_orange_days", Number(e.target.value))}
                      inputMode="numeric"
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
                    />
                  </label>
                  <label style={{ fontSize: 12, opacity: 0.8 }}>
                    🔴 Red ≤
                    <input
                      disabled={!canEdit}
                      value={String(s.usage_red_days)}
                      onChange={(e) => setField("usage_red_days", Number(e.target.value))}
                      inputMode="numeric"
                      style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e5e5", marginTop: 6 }}
                    />
                  </label>
                </div>
                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
                  “Días estimados” = (uso restante / promedio diario).
                </div>
              </div>

              <button type="submit" disabled={!canEdit || saving} style={{ padding: "10px 12px", width: "fit-content" }}>
                {saving ? "Guardando…" : "Guardar"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
