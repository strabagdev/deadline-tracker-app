"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function AppHeader() {
  const router = useRouter();
  const [orgName, setOrgName] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        router.replace("/login");
        return;
      }

      // ✅ Auto-sync profile (idempotente)
      await fetch("/api/profile/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      // Org activa
      const res = await fetch("/api/orgs/active", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        router.replace("/select-org");
        return;
      }

      setOrgName(json.organization?.name ?? "");
      setLoading(false);
    })();
  }, [router]);

  async function logout() {
    await supabaseAuth.auth.signOut();
    router.replace("/login");
  }

  return (
    <header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        padding: 16,
        borderBottom: "1px solid #eee",
      }}
    >
      <div>
        <div style={{ fontWeight: 700 }}>OpsAhead</div>
        <div style={{ opacity: 0.75, fontSize: 13, marginTop: 4 }}>
          {loading
            ? "Cargando organización..."
            : orgName
              ? `Org: ${orgName}`
              : "Sin organización"}
        </div>
      </div>

      <button onClick={logout} style={{ padding: 10 }}>
        Cerrar sesión
      </button>
    </header>
  );
}
