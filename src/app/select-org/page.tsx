"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";

type Org = { id: string; name: string; role: string };
type AccessRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at?: string | null;
  organization_id?: string | null;
  assigned_role?: string | null;
  note?: string | null;
};

function getReadableErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "string" && error.trim() && error.trim().toLowerCase() !== "error") return error.trim();
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const maybe = error as { error?: unknown; message?: unknown; details?: unknown };
    const parts = [maybe.error, maybe.message, maybe.details]
      .map((value) => String(value ?? "").trim())
      .filter((value) => value.length > 0 && value.toLowerCase() !== "error");
    if (parts.length > 0) return parts.join(" · ");
  }
  return fallback;
}

export default function SelectOrgPage() {
  const router = useRouter();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [primarySuperAdminEmail, setPrimarySuperAdminEmail] = useState("");
  const [accessRequest, setAccessRequest] = useState<AccessRequest | null>(null);

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getTokenOrRedirect(): Promise<string | null> {
    const { data } = await supabaseAuth.auth.getSession();
    if (!data.session?.access_token) {
      router.replace("/login");
      return null;
    }

    const { data: userData, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !userData.user) {
      await supabaseAuth.auth.signOut();
      router.replace("/login");
      return null;
    }

    const { data: refreshed } = await supabaseAuth.auth.getSession();
    const token = refreshed.session?.access_token;
    if (!token) {
      await supabaseAuth.auth.signOut();
      router.replace("/login");
      return null;
    }

    return token;
  }

  async function init() {
    setLoading(true);
    setError("");

    try {
      const token = await getTokenOrRedirect();
      if (!token) {
        setLoading(false);
        return;
      }

      let res = await fetch("/api/orgs", {
        headers: { Authorization: `Bearer ${token}` },
      });

      let json = await res.json().catch(() => ({}));
      if (!res.ok && String(json?.error || "").toLowerCase().includes("invalid session")) {
        await supabaseAuth.auth.refreshSession();
        const refreshedToken = await getTokenOrRedirect();
        if (!refreshedToken) return;
        res = await fetch("/api/orgs", {
          headers: { Authorization: `Bearer ${refreshedToken}` },
        });
        json = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        setError(getReadableErrorMessage(json?.error, "No se pudieron cargar tus organizaciones. Revisa tu conexión e inténtalo nuevamente."));
        setLoading(false);
        return;
      }

      if (json.is_super_admin) {
        router.replace("/app/super-admin");
        return;
      }

      const list: Org[] = Array.isArray(json.orgs) ? json.orgs : [];
      setAccessRequest(json.access_request ?? null);
      setOrgs(list);

      if (list.length === 1) {
        const setRes = await fetch("/api/orgs/set-active", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ organizationId: list[0].id }),
        });

        if (setRes.ok) {
          router.replace("/app");
          return;
        }

        const setJson = await setRes.json().catch(() => ({}));
        setError(getReadableErrorMessage(setJson?.error, "No se pudo seleccionar la organización automáticamente."));
        setLoading(false);
        return;
      }

      if (list.length === 0) {
        const hasSuperAdmin = Boolean(json.has_super_admin);
        const currentIsSuperAdmin = Boolean(json.is_super_admin);
        setIsSuperAdmin(currentIsSuperAdmin);
        setPrimarySuperAdminEmail(String(json.primary_super_admin_email || ""));

        if (!hasSuperAdmin) {
          router.replace("/setup-super-admin");
          return;
        }
      }

      setLoading(false);
    } catch (error: unknown) {
      setError(getReadableErrorMessage(error, "No se pudieron cargar tus organizaciones. Revisa tu conexión e inténtalo nuevamente."));
      setLoading(false);
    }
  }

  async function chooseOrg(orgId: string) {
    setBusy(true);
    setError("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/orgs/set-active", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ organizationId: orgId }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getReadableErrorMessage(json?.error, "No se pudo seleccionar la organización."));
        setBusy(false);
        return;
      }

      router.replace("/app");
    } catch (error: unknown) {
      setError(getReadableErrorMessage(error, "No se pudo seleccionar la organización. Revisa tu conexión e inténtalo nuevamente."));
      setBusy(false);
    }
  }

  async function exitAccessFlow() {
    setBusy(true);
    setError("");
    try {
      await supabaseAuth.auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  if (loading)
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <Loader label="Cargando organizaciones..." showLabel />
      </main>
    );

  const hasNoOrgs = orgs.length === 0;
  const hasManyOrgs = orgs.length > 1;
  const pendingRequest = accessRequest?.status === "pending";
  const rejectedRequest = accessRequest?.status === "rejected";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-3xl items-center justify-center">
        <section className="flex w-full items-center justify-center">
          <Card className="w-full max-w-xl border-slate-200 bg-white shadow-[0_24px_48px_-36px_rgba(15,23,42,0.24)]">
            <CardHeader className="pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Acceso</Badge>
                {hasManyOrgs ? <Badge variant="outline">Múltiples organizaciones</Badge> : null}
                {pendingRequest ? <Badge variant="outline">Solicitud pendiente</Badge> : null}
                {rejectedRequest ? <Badge variant="outline">Solicitud rechazada</Badge> : null}
                {isSuperAdmin ? <Badge variant="outline">Super admin</Badge> : null}
              </div>
              <CardTitle className="mt-3 text-3xl tracking-tight">
                {hasNoOrgs ? "Estado de acceso" : hasManyOrgs ? "Elige tu organización" : "Resolviendo acceso"}
              </CardTitle>
              <CardDescription className="text-sm leading-6">
                {hasNoOrgs
                  ? "Tu sesión está lista, pero todavía debemos resolver cómo ingresas a la plataforma."
                  : hasManyOrgs
                    ? "Tu usuario aparece con acceso a más de una organización. Elige una para continuar."
                    : "Estamos terminando de preparar tu contexto operativo."}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5">
              {error ? <div className="app-alert app-alert-error whitespace-pre-wrap">{error}</div> : null}

              {hasNoOrgs && !error ? (
                <div className="space-y-4">
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
                    <p>No tienes acceso activo a ninguna organización en esta plataforma.</p>
                    {pendingRequest ? (
                      <p className="mt-2">
                        Tu solicitud de acceso está pendiente de revisión desde{" "}
                        <b>{new Date(accessRequest.requested_at).toLocaleString()}</b>.
                      </p>
                    ) : null}
                    {rejectedRequest ? (
                      <p className="mt-2">
                        Tu solicitud de acceso fue rechazada
                        {accessRequest?.resolved_at ? ` el ${new Date(accessRequest.resolved_at).toLocaleString()}` : ""}.
                        {accessRequest?.note ? ` Motivo: ${accessRequest.note}` : ""}
                      </p>
                    ) : null}
                  </div>

                  {isSuperAdmin ? (
                    <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                      Eres super admin. Puedes crear y administrar organizaciones desde el panel global.
                    </div>
                  ) : (
                    <div className="rounded-[18px] border border-slate-200 bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                      Solicita invitación a un administrador.
                      {primarySuperAdminEmail ? ` Super admin registrado: ${primarySuperAdminEmail}.` : ""}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {isSuperAdmin ? (
                      <Button onClick={() => router.replace("/app/super-admin")} disabled={busy} className="rounded-xl">
                        Ir a super admin
                      </Button>
                    ) : null}
                    <Button onClick={() => void exitAccessFlow()} disabled={busy} variant="outline" className="rounded-xl">
                      Cerrar sesión
                    </Button>
                    <Button onClick={() => router.replace("/login")} disabled={busy} variant="ghost" className="rounded-xl">
                      Volver al login
                    </Button>
                  </div>
                </div>
              ) : hasManyOrgs ? (
                <div className="space-y-4">
                  <div className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
                    Tu usuario aparece vinculado a más de una organización. Eso no es el caso esperado, pero puedes
                    elegir una para continuar mientras revisamos el modelo.
                  </div>

                  <div className="grid gap-3">
                    {orgs.map((o) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => void chooseOrg(o.id)}
                        disabled={busy}
                        className="rounded-[18px] border border-slate-200 bg-white px-4 py-4 text-left transition-colors hover:bg-slate-50 disabled:opacity-60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-semibold text-slate-900">{o.name}</div>
                            <div className="mt-1 text-sm text-slate-500">Rol: {o.role}</div>
                          </div>
                          <Badge variant="secondary">Entrar</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-[18px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-slate-700">
                  Organización detectada. Entrando...
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
