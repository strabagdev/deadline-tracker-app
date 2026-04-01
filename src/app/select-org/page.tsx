"use client";

import Image from "next/image";
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

function getRoleLabel(role: string) {
  const normalized = role.trim().toLowerCase();
  if (normalized === "owner") return "Owner";
  if (normalized === "admin") return "Admin";
  if (normalized === "member") return "Miembro";
  if (normalized === "super_admin") return "Super admin";
  return role || "Sin rol";
}

export default function SelectOrgPage() {
  const router = useRouter();

  const [orgs, setOrgs] = useState<Org[]>([]);
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");
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

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const brandingRes = await fetch("/api/platform/branding", { cache: "no-store" });
        const brandingJson = await brandingRes.json().catch(() => ({}));
        if (!cancelled && brandingRes.ok) {
          setPlatformLogoUrl(String(brandingJson?.platform?.logo_url ?? ""));
        }
      } catch {
        if (!cancelled) setPlatformLogoUrl("");
      }
    })();

    return () => {
      cancelled = true;
    };
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
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#eef4fb_0%,#f8fafc_46%,#ffffff_100%)] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center justify-center">
        <section className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="relative overflow-hidden rounded-[32px] border border-[#d7e2f1] bg-[linear-gradient(145deg,#173055_0%,#264a7e_54%,#3b679f_100%)] px-6 py-7 text-white shadow-[0_30px_80px_-42px_rgba(15,23,42,0.45)] sm:px-8 sm:py-8">
            <div className="absolute left-0 top-0 h-48 w-48 -translate-x-16 -translate-y-16 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute bottom-0 right-0 h-56 w-56 translate-x-20 translate-y-16 rounded-full bg-[#89a8d8]/20 blur-3xl" />
            <div className="relative flex h-full flex-col justify-between gap-8">
              <div className="space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/16 bg-white/10 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.65)] backdrop-blur-sm">
                      {platformLogoUrl ? (
                        <Image src={platformLogoUrl} alt="Logo de OpsAhead" width={40} height={40} className="h-10 w-10 rounded-lg object-contain" priority />
                      ) : (
                        <Image src="/icons/icon-oa.svg" alt="Logo de OpsAhead" width={38} height={38} className="h-9.5 w-9.5" priority />
                      )}
                    </div>
                    <div>
                      <div className="text-lg font-semibold tracking-[-0.03em] text-white">OpsAhead</div>
                      <div className="text-sm text-white/70">Operations intelligence platform</div>
                    </div>
                  </div>
                  <Badge className="border border-white/20 bg-white/8 text-white">Control de acceso</Badge>
                </div>

                <div className="max-w-xl space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/70">Workspace Gateway</p>
                  <h1 className="text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                    {hasNoOrgs ? "Tu acceso necesita contexto." : hasManyOrgs ? "Elige dónde quieres trabajar." : "Preparando tu ingreso."}
                  </h1>
                  <p className="max-w-lg text-sm leading-6 text-white/80 sm:text-[15px]">
                    {hasNoOrgs
                      ? "La sesión está activa, pero aún no hay una organización operativa asociada a tu usuario."
                      : hasManyOrgs
                        ? "Detectamos más de una organización asociada a tu cuenta. Selecciona una para cargar el contexto correcto."
                        : "Encontramos una única organización disponible y estamos terminando la configuración para entrar."}
                  </p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-[22px] border border-white/14 bg-white/10 p-4 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Acceso</div>
                  <div className="mt-3 text-lg font-semibold tracking-tight">
                    {hasNoOrgs ? "Sin membresía activa" : hasManyOrgs ? "Selección requerida" : "Ingreso directo"}
                  </div>
                  <div className="mt-1 text-sm text-white/72">
                    {hasNoOrgs ? "La sesión está lista, pero falta definir el espacio de trabajo." : hasManyOrgs ? "Hay más de una opción disponible para continuar." : "El acceso ya está resuelto y estamos entrando."}
                  </div>
                </div>
                <div className="rounded-[22px] border border-white/14 bg-white/10 p-4 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Siguiente paso</div>
                  <div className="mt-3 text-lg font-semibold tracking-tight">
                    {pendingRequest ? "Esperar revisión" : rejectedRequest ? "Revisar rechazo" : hasManyOrgs ? "Elegir organización" : isSuperAdmin ? "Abrir panel global" : "Continuar"}
                  </div>
                  <div className="mt-1 text-sm text-white/72">
                    {pendingRequest
                      ? "Tu solicitud está siendo evaluada por administración."
                      : rejectedRequest
                        ? "Consulta el motivo o pide una nueva invitación."
                        : hasManyOrgs
                          ? "Selecciona el entorno correcto para este ingreso."
                          : isSuperAdmin
                            ? "Puedes administrar branding, usuarios y organizaciones."
                            : "Entraremos con la configuración disponible."}
                  </div>
                </div>
                <div className="rounded-[22px] border border-white/14 bg-white/10 p-4 backdrop-blur-sm">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Perfil</div>
                  <div className="mt-3 text-lg font-semibold tracking-tight">{isSuperAdmin ? "Super admin" : "Usuario"}</div>
                  <div className="mt-1 text-sm text-white/72">
                    {isSuperAdmin ? "Vista global de plataforma y configuración central." : "Ingreso operativo según el rol asignado en cada organización."}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <Card className="w-full overflow-hidden border-[#d9e3f0] bg-white/90 shadow-[0_30px_80px_-52px_rgba(15,23,42,0.45)] backdrop-blur">
            <CardHeader className="border-b border-slate-100 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Acceso</Badge>
                {hasManyOrgs ? <Badge variant="outline">Múltiples organizaciones</Badge> : null}
                {pendingRequest ? <Badge variant="outline">Solicitud pendiente</Badge> : null}
                {rejectedRequest ? <Badge variant="outline">Solicitud rechazada</Badge> : null}
                {isSuperAdmin ? <Badge variant="outline">Super admin</Badge> : null}
              </div>
              <CardTitle className="mt-4 text-[28px] tracking-[-0.03em] text-slate-950">
                {hasNoOrgs ? "Estado de acceso" : hasManyOrgs ? "Selecciona una organización" : "Resolviendo acceso"}
              </CardTitle>
              <CardDescription className="max-w-xl text-sm leading-6 text-slate-600">
                {hasNoOrgs
                  ? "Te mostramos el estado actual de tu acceso y las acciones disponibles para continuar."
                  : hasManyOrgs
                    ? "Cada opción carga tu entorno de trabajo con el rol y el contexto asociados."
                    : "Estamos redirigiéndote automáticamente al entorno disponible."}
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-5 pt-5">
              {error ? <div className="app-alert app-alert-error whitespace-pre-wrap">{error}</div> : null}

              {hasNoOrgs && !error ? (
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#f3f7fc_100%)] p-5 text-sm leading-6 text-slate-700">
                    <div className="flex items-start gap-3">
                      <div className="mt-1 h-2.5 w-2.5 rounded-full bg-slate-400" />
                      <div>
                        <p className="font-medium text-slate-900">No hay una organización activa vinculada a esta cuenta.</p>
                        {pendingRequest ? (
                          <p className="mt-2">
                            Tu solicitud está pendiente desde <b>{new Date(accessRequest.requested_at).toLocaleString()}</b>.
                          </p>
                        ) : null}
                        {rejectedRequest ? (
                          <p className="mt-2">
                            La solicitud fue rechazada
                            {accessRequest?.resolved_at ? ` el ${new Date(accessRequest.resolved_at).toLocaleString()}` : ""}.
                            {accessRequest?.note ? ` Motivo: ${accessRequest.note}` : ""}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Siguiente paso</div>
                      <p className="mt-2">
                        {isSuperAdmin
                          ? "Puedes crear o administrar organizaciones desde el panel global."
                          : `Solicita invitación a un administrador${primarySuperAdminEmail ? ` o escribe a ${primarySuperAdminEmail}` : ""}.`}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Estado de cuenta</div>
                      <p className="mt-2">
                        {pendingRequest
                          ? "Conserva esta sesión si estás esperando aprobación."
                          : rejectedRequest
                            ? "Puedes cerrar sesión y volver cuando se actualice tu acceso."
                            : "Tu usuario está autenticado, pero sin membresía operativa todavía."}
                      </p>
                    </div>
                  </div>

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
                  <div className="rounded-[22px] border border-amber-200 bg-[linear-gradient(180deg,#fff8eb_0%,#fff4d8_100%)] p-4 text-sm leading-6 text-amber-950">
                    Tu usuario aparece vinculado a varias organizaciones. No es el flujo más habitual, pero puedes elegir una y continuar sin perder contexto.
                  </div>

                  <div className="grid gap-3">
                    {orgs.map((o, index) => (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => void chooseOrg(o.id)}
                        disabled={busy}
                        className="group rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-[0_20px_40px_-28px_rgba(45,79,135,0.55)] disabled:transform-none disabled:opacity-60"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent)]">
                                {String(index + 1).padStart(2, "0")}
                              </div>
                              <div>
                                <div className="text-lg font-semibold tracking-tight text-slate-950">{o.name}</div>
                                <div className="mt-1 text-sm text-slate-500">Rol asignado: {getRoleLabel(o.role)}</div>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            <Badge variant="secondary" className="rounded-full px-3 py-1 text-[11px]">
                              Entrar
                            </Badge>
                            <span className="text-xs font-medium text-slate-400 transition-colors group-hover:text-[var(--accent)]">
                              Abrir espacio de trabajo
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#eef4fb_100%)] p-5 text-sm leading-6 text-slate-700">
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
