"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import type { EmailOtpType } from "@supabase/supabase-js";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [msg, setMsg] = useState("Finalizando inicio de sesión...");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [mustLoginAgain, setMustLoginAgain] = useState(false);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type") as EmailOtpType | null;

      // Intercambia code -> session (necesario para que la sesión quede persistida)
      if (code) {
        const { error } = await supabaseAuth.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("exchangeCodeForSession error:", error.message);
          router.replace("/login");
          return;
        }
      } else if (tokenHash && type) {
        const { error } = await supabaseAuth.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (error) {
          console.error("verifyOtp error:", error.message);
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
      const syncRes = await fetch("/api/profile/sync", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });

      if (!syncRes.ok) {
        const json = await syncRes.json().catch(() => ({}));
        setMsg(json.error || "No se pudo completar la sincronización de perfil. Intenta ingresar de nuevo.");
        return;
      }

      const tempPasswordRes = await fetch("/api/auth/provision-temp-password", {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const tempPasswordJson = await tempPasswordRes.json().catch(() => ({}));
      if (!tempPasswordRes.ok) {
        setMsg(
          tempPasswordJson.error ||
            "No se pudo generar la contraseña provisoria de invitación. Intenta ingresar de nuevo."
        );
        return;
      }

      if (tempPasswordJson.created && tempPasswordJson.temporary_password) {
        const generatedPassword = String(tempPasswordJson.temporary_password);
        const userEmail = data.session.user.email?.trim().toLowerCase() ?? "";

        // Al actualizar password por Admin API, la sesión del magic link puede invalidarse.
        // Reautenticamos inmediatamente con la contraseña provisoria para evitar "Invalid session".
        if (userEmail) {
          await supabaseAuth.auth.signOut();
          const { error: signInErr } = await supabaseAuth.auth.signInWithPassword({
            email: userEmail,
            password: generatedPassword,
          });
          if (signInErr) {
            setTemporaryPassword(generatedPassword);
            setMustLoginAgain(true);
            setMsg(
              "Tu acceso fue activado, pero debes iniciar sesión de nuevo con la contraseña provisoria."
            );
            return;
          }
        }

        setTemporaryPassword(generatedPassword);
        setMsg("Tu acceso fue activado. Guarda esta contraseña provisoria y luego cámbiala en tu perfil.");
        return;
      }

      router.replace("/select-org");
    })();
  }, [router]);

  return (
    <main style={{ padding: 16, maxWidth: 680, margin: "0 auto" }}>
      <p>{msg}</p>
      {temporaryPassword ? (
        <>
          <p>
            <b>Contraseña provisoria:</b> <code>{temporaryPassword}</code>
          </p>
          <button onClick={() => router.replace(mustLoginAgain ? "/login" : "/select-org")} style={{ padding: 10 }}>
            Continuar
          </button>
        </>
      ) : null}
    </main>
  );
}
