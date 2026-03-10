"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { supabaseAuth } from "@/lib/supabase/authClient";

type DeliveryResponse = {
  ok?: boolean;
  email?: string;
  redirect_to?: string;
  invited_user_id?: string | null;
  delivery?: string;
  error?: string;
  code?: string;
};

export default function TestInvitePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState<DeliveryResponse | null>(null);

  useEffect(() => {
    void bootstrap();
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

  async function bootstrap() {
    setLoading(true);
    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

    const res = await fetch("/api/orgs/branding", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    const nextRole = String(json.role ?? "");
    setRole(nextRole);
    setLoading(false);

    if (nextRole !== "owner") {
      setError("Solo el owner puede usar esta prueba de envío.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setResponse(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Email requerido");
      return;
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    setBusy(true);
    const res = await fetch("/api/admin/invite/test", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: cleanEmail }),
    });

    const json = (await res.json().catch(() => ({}))) as DeliveryResponse;
    setResponse(json);
    if (!res.ok) {
      setError(json.error || "No se pudo ejecutar la prueba de invitación");
      setBusy(false);
      return;
    }

    setMessage("Solicitud enviada a Supabase. Revisa la bandeja y el spam.");
    setBusy(false);
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-4 py-6">
        <Loader label="Cargando prueba de invitación..." />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Prueba de invitación</h1>
          <p className="mt-1 text-sm text-slate-600">
            Ejecuta un envío directo por Supabase Auth para validar si el correo sale correctamente.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/app/users">Volver a usuarios</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Enviar correo de prueba</CardTitle>
          <CardDescription>
            Disponible solo para owner. No asigna permisos ni vincula al usuario a la organización: solo prueba el envío.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

          {role !== "owner" ? (
            <p className="text-sm text-slate-600">Tu rol actual es `{role || "desconocido"}`.</p>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-900" htmlFor="test-invite-email">
                  Email destino
                </label>
                <Input
                  id="test-invite-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu-correo@empresa.com"
                  disabled={busy}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={busy}>
                  {busy ? "Enviando..." : "Enviar prueba"}
                </Button>
                <Button type="button" variant="outline" disabled={busy} onClick={() => {
                  setEmail("");
                  setError("");
                  setMessage("");
                  setResponse(null);
                }}>
                  Limpiar
                </Button>
              </div>
            </form>
          )}

          {response ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <div><strong>Resultado:</strong> {response.ok ? "ok" : "error"}</div>
              {response.email ? <div><strong>Email:</strong> {response.email}</div> : null}
              {response.delivery ? <div><strong>Delivery:</strong> {response.delivery}</div> : null}
              {response.redirect_to ? <div><strong>Redirect:</strong> {response.redirect_to}</div> : null}
              {response.invited_user_id ? <div><strong>User ID:</strong> {response.invited_user_id}</div> : null}
              {response.error ? <div><strong>Error:</strong> {response.error}</div> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
