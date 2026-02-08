"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      // El magic link vuelve con ?code=...
      const code = new URLSearchParams(window.location.search).get("code");

      // Intercambia code -> session (necesario para que la sesión quede persistida)
      if (code) {
        const { error } = await supabaseAuth.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("exchangeCodeForSession error:", error.message);
          router.replace("/login");
          return;
        }
      }

      // Confirma sesión
      const { data } = await supabaseAuth.auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }

      // ✅ Sync profile (user_id + email) hacia la DB de datos
      await fetch("/api/profile/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });

      // Luego seguimos el flujo normal
      router.replace("/select-org");
    })();
  }, [router]);

  return <p style={{ padding: 16 }}>Finalizando inicio de sesión...</p>;
}
