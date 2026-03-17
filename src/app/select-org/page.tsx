"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader } from "@/components/ui/loader";

type Org = { id: string; name: string; role: string };
type SuperAdminStatus = {
  has_super_admin?: boolean;
  is_super_admin?: boolean;
  primary_super_admin_email?: string | null;
};
type AccessRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  resolved_at?: string | null;
  organization_id?: string | null;
  assigned_role?: string | null;
  note?: string | null;
};

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

    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

    const superRes = await fetch("/api/platform/super-admin/status", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const superJson = (await superRes.json().catch(() => ({}))) as SuperAdminStatus & { error?: string };
    if (!superRes.ok) {
      setError(superJson.error || "No se pudo validar estado de super admin");
      setLoading(false);
      return;
    }

    if (superJson.is_super_admin) {
      router.replace("/app/super-admin");
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
      setError(json.error || "Error cargando organizaciones");
      setLoading(false);
      return;
    }

    const list: Org[] = Array.isArray(json.orgs) ? json.orgs : [];
    setAccessRequest(json.access_request ?? null);
    setOrgs(list);

    // ✅ Regla: 1 usuario = 1 org. Si hay 1, entramos automáticamente.
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
      setError(setJson.error || "No se pudo seleccionar la organización automáticamente");
      setLoading(false);
      return;
    }

    if (list.length === 0) {
      const hasSuperAdmin = Boolean(superJson.has_super_admin);
      const currentIsSuperAdmin = Boolean(superJson.is_super_admin);
      setIsSuperAdmin(currentIsSuperAdmin);
      setPrimarySuperAdminEmail(String(superJson.primary_super_admin_email || ""));

      if (!hasSuperAdmin) {
        router.replace("/setup-super-admin");
        return;
      }
    }

    setLoading(false);
  }

  async function chooseOrg(orgId: string) {
    setBusy(true);
    setError("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

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
      setError(json.error || "No se pudo seleccionar organización");
      setBusy(false);
      return;
    }

    router.replace("/app");
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(15,118,110,0.12),transparent_26%),radial-gradient(circle_at_bottom_right,rgba(45,79,135,0.12),transparent_28%),linear-gradient(180deg,#f3f7fb_0%,#edf4f0_100%)] px-4 py-6">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] max-w-[1180px] gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden overflow-hidden rounded-[34px] border border-white/45 bg-[linear-gradient(140deg,rgba(10,31,33,0.98),rgba(9,88,81,0.92))] px-8 py-8 text-white shadow-[0_30px_90px_rgba(15,23,42,0.16)] lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.32em] text-emerald-200/78">Resolución de acceso</div>
            <h1 className="mt-8 max-w-xl text-5xl font-semibold leading-[1.02] tracking-tight">
              Antes de entrar, confirmamos tu contexto organizacional.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/72">
              Esta etapa decide si debes entrar directo, elegir organización, esperar aprobación o continuar con
              administración global. La autenticación ya está resuelta; aquí cerramos el contexto operativo.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[26px] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/58">Contexto</div>
              <div className="mt-3 text-lg font-semibold">Organización</div>
              <p className="mt-2 text-sm leading-6 text-white/65">La plataforma necesita saber en qué organización vas a operar.</p>
            </div>
            <div className="rounded-[26px] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/58">Control</div>
              <div className="mt-3 text-lg font-semibold">Acceso</div>
              <p className="mt-2 text-sm leading-6 text-white/65">Si tu cuenta está pendiente, aquí se te muestra el estado sin mezclarlo con el login.</p>
            </div>
            <div className="rounded-[26px] border border-white/12 bg-white/8 px-4 py-4 backdrop-blur-sm">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/58">Resolución</div>
              <div className="mt-3 text-lg font-semibold">Unificada</div>
              <p className="mt-2 text-sm leading-6 text-white/65">Superadmin, membresías y solicitudes convergen en una sola pantalla de decisión.</p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center lg:px-8">
          <Card className="w-full max-w-2xl overflow-hidden bg-white/86 backdrop-blur">
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
                  <div className="rounded-[22px] border border-[rgba(17,32,28,0.08)] bg-[rgba(215,243,239,0.28)] px-4 py-4 text-sm leading-6 text-slate-700">
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
                    <div className="rounded-[22px] border border-[rgba(17,32,28,0.08)] bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                      Eres super admin. Puedes crear y administrar organizaciones desde el panel global.
                    </div>
                  ) : (
                    <div className="rounded-[22px] border border-[rgba(17,32,28,0.08)] bg-white px-4 py-4 text-sm leading-6 text-slate-700">
                      Solicita invitación a un administrador.
                      {primarySuperAdminEmail ? ` Super admin registrado: ${primarySuperAdminEmail}.` : ""}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-3">
                    {isSuperAdmin ? (
                      <Button onClick={() => router.replace("/app/super-admin")} disabled={busy} className="rounded-2xl">
                        Ir a super admin
                      </Button>
                    ) : null}
                    <Button onClick={() => void exitAccessFlow()} disabled={busy} variant="outline" className="rounded-2xl">
                      Cerrar sesión
                    </Button>
                    <Button onClick={() => router.replace("/login")} disabled={busy} variant="ghost" className="rounded-2xl">
                      Volver al login
                    </Button>
                  </div>
                </div>
              ) : hasManyOrgs ? (
                <div className="space-y-4">
                  <div className="rounded-[22px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-900">
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
                        className="rounded-[22px] border border-[rgba(17,32,28,0.08)] bg-white px-4 py-4 text-left transition-colors hover:bg-[rgba(215,243,239,0.2)] disabled:opacity-60"
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
                <div className="rounded-[22px] border border-[rgba(17,32,28,0.08)] bg-[rgba(215,243,239,0.28)] px-4 py-4 text-sm leading-6 text-slate-700">
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
