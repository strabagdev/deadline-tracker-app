"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      if (!data.session) router.replace("/login");
      else router.replace("/select-org");
    })();
  }, [router]);

  return (
    <main style={{ padding: 16 }}>
      <p>Cargando…</p>
    </main>
  );
}
