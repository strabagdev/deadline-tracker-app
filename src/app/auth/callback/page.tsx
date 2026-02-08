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

      if (code) {
        const { error } = await supabaseAuth.auth.exchangeCodeForSession(code);
        if (error) {
          router.replace("/login");
          return;
        }
      }

      const { data } = await supabaseAuth.auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }

      router.replace("/select-org");
    })();
  }, [router]);

  return <p style={{ padding: 16 }}>Finalizando inicio de sesión...</p>;
}
