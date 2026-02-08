"use client";

import { useState } from "react";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function AppHomePage() {
  const [msg, setMsg] = useState("");

  async function syncProfile() {
    setMsg("Sincronizando...");
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      setMsg("No hay sesión");
      return;
    }

    const res = await fetch("/api/profile/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));
    setMsg(`status ${res.status}: ${JSON.stringify(json)}`);
  }

  return (
    <main style={{ padding: 16 }}>
      <h2>Dashboard</h2>

      <button onClick={syncProfile} style={{ padding: 10 }}>
        Sync profile (test)
      </button>

      {msg && <pre style={{ marginTop: 12 }}>{msg}</pre>}
    </main>
  );
}
