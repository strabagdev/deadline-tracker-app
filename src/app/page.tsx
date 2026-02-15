"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const publicStatusRes = await fetch("/api/platform/super-admin/public-status");
      const publicStatusJson = await publicStatusRes.json().catch(() => ({}));

      if (publicStatusRes.ok && publicStatusJson && publicStatusJson.has_super_admin === false) {
        router.replace("/setup-super-admin");
        return;
      }

      const { data } = await supabaseAuth.auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }

      const statusRes = await fetch("/api/platform/super-admin/status", {
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const statusJson = await statusRes.json().catch(() => ({}));

      if (statusRes.ok && statusJson && statusJson.has_super_admin === false) {
        router.replace("/setup-super-admin");
        return;
      }

      if (statusRes.ok && statusJson && statusJson.is_super_admin === true) {
        router.replace("/app/super-admin");
        return;
      }

      router.replace("/select-org");
    })();
  }, [router]);

  return (
    <main style={{ padding: 16 }}>
      <p>Cargando…</p>
    </main>
  );
}
