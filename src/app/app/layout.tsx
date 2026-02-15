"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

function IconPlus({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconTraffic({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="7" y="2" width="10" height="20" rx="4" />
      <circle cx="12" cy="7" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="12" cy="17" r="1.4" />
    </svg>
  );
}

function IconRefresh({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 12a9 9 0 0 1 15.5-6.36L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.36L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/app" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      className={cn(
        "rounded-xl border px-3 py-2 text-sm text-slate-700 transition-colors",
        active ? "border-slate-300 bg-slate-100 text-slate-900" : "border-transparent hover:bg-slate-100"
      )}
    >
      {label}
    </Link>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false);
  const [sessionEmail, setSessionEmail] = React.useState("");
  const [platformLogoUrl, setPlatformLogoUrl] = React.useState("");
  const [activeOrgName, setActiveOrgName] = React.useState("");
  const [activeOrgLogoUrl, setActiveOrgLogoUrl] = React.useState("");
  const isDashboardHome = pathname === "/app";
  const isSuperAdminArea = pathname.startsWith("/app/super-admin");
  const isSuperAdminLockedOutRoute = isSuperAdmin && !isSuperAdminArea;

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      const token = data.session?.access_token;
      const email = data.session?.user?.email || "";
      if (!cancelled) setSessionEmail(email);
      if (!token) return;

      const [statusRes, platformRes] = await Promise.all([
        fetch("/api/platform/super-admin/status", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch("/api/platform/branding", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const json = await statusRes.json().catch(() => ({}));
      const platformJson = await platformRes.json().catch(() => ({}));
      if (!cancelled) {
        const currentIsSuperAdmin = Boolean(json?.is_super_admin);
        setPlatformLogoUrl(platformJson?.platform?.logo_url ?? "");
        setIsSuperAdmin(currentIsSuperAdmin);
        if (!currentIsSuperAdmin) {
          const orgRes = await fetch("/api/orgs/active", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const orgJson = await orgRes.json().catch(() => ({}));
          if (cancelled) return;
          setActiveOrgName(orgJson?.organization?.name ?? "");
          setActiveOrgLogoUrl(orgJson?.organization?.logo_url ?? "");
        } else {
          setActiveOrgName("");
          setActiveOrgLogoUrl("");
        }
        if (currentIsSuperAdmin && pathname && !pathname.startsWith("/app/super-admin")) {
          router.replace("/app/super-admin");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  async function logout() {
    await supabaseAuth.auth.signOut();
    router.replace("/login");
  }

  function refreshDashboard() {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("dashboard-refresh"));
    }
  }

  const userInfoCapsule = !isSuperAdmin ? (
    <div className="hidden min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 md:flex">
      {activeOrgLogoUrl ? (
        <img
          src={activeOrgLogoUrl}
          alt="Logo organización"
          width={20}
          height={20}
          className="h-5 w-5 rounded-md border object-cover"
        />
      ) : null}
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-slate-700">
          {activeOrgName || "Sin organización"}
        </div>
        <div className="truncate text-[11px] text-slate-500">
          {sessionEmail || "(sin email)"}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
        <div className={cn("mx-auto grid gap-1 px-4", isDashboardHome ? "max-w-[1400px] py-2" : "max-w-[1100px] py-2")}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 whitespace-nowrap">
              {platformLogoUrl ? (
                <img
                  src={platformLogoUrl}
                  alt="Logo plataforma"
                  width={38}
                  height={38}
                  className="h-9 w-9 rounded-lg object-cover"
                />
              ) : null}
              <Link href={isSuperAdmin ? "/app/super-admin" : "/app"} className="text-base font-semibold text-slate-900">
                OpsAhead
              </Link>
              {isSuperAdmin ? <Badge variant="secondary">Global</Badge> : null}
            </div>

            {isSuperAdmin ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                <Link href="/app/super-admin">
                  <Button variant="outline" size="sm">
                    Panel global
                  </Button>
                </Link>
                <Button onClick={logout} variant="outline" size="sm">
                  Salir
                </Button>
              </div>
            ) : isDashboardHome ? (
              <div className="flex w-full items-center gap-2 overflow-x-auto pb-1 sm:w-auto sm:overflow-visible sm:pb-0">
                <Link href="/app/entities?new=1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    title="Nueva entidad"
                    aria-label="Nueva entidad"
                  >
                    <IconPlus />
                  </Button>
                </Link>
                <Link href="/app/settings/semaphore">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    title="Semáforo"
                    aria-label="Semáforo"
                  >
                    <IconTraffic />
                  </Button>
                </Link>
                <Button
                  onClick={refreshDashboard}
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  title="Refrescar"
                  aria-label="Refrescar"
                >
                  <IconRefresh />
                </Button>
                <Link href="/app/entities">
                  <Button variant="outline" size="sm" className="shrink-0">
                    Menú
                  </Button>
                </Link>
                <Link href="/app/profile">
                  <Button variant="outline" size="sm" className="shrink-0">
                    Perfil
                  </Button>
                </Link>
                <Button onClick={logout} variant="outline" size="sm" className="shrink-0">
                  Salir
                </Button>
                {userInfoCapsule}
              </div>
            ) : (
              <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-1 sm:flex-row sm:items-center">
                <nav className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto">
                  <NavLink href="/app" label="Dashboard" />
                  <NavLink href="/app/entities" label="Entidades" />
                  <NavLink href="/app/entity-types" label="Tipos entidad" />
                  <NavLink href="/app/deadline-types" label="Tipos vencimiento" />
                  <NavLink href="/app/users" label="Usuarios" />
                </nav>
                <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto">
                  <Link href="/app/profile">
                    <Button variant="outline" size="sm">
                      Perfil
                    </Button>
                  </Link>
                  <Button onClick={logout} variant="outline" size="sm">
                    Salir
                  </Button>
                  {userInfoCapsule}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1">
        {isSuperAdminLockedOutRoute ? (
          <div className="flex justify-center p-4">
            <Loader label="Redirigiendo al panel global..." />
          </div>
        ) : (
          children
        )}
      </div>

      <footer className="border-t bg-white px-4 py-3">
        <div className="mx-auto max-w-[1100px] text-xs text-slate-500">
          v2 · Fase: Optimización UX/UI + validación integral de flujos
        </div>
      </footer>
    </div>
  );
}
