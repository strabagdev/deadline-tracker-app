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

function IconMenu({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 6h18" />
      <path d="M3 12h18" />
      <path d="M3 18h18" />
    </svg>
  );
}

function IconUser({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="8" r="4" />
    </svg>
  );
}

function IconLogout({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
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
        "rounded-xl border bg-transparent px-3 py-2 text-sm text-slate-700 transition-colors",
        active ? "border-slate-300 text-slate-900" : "border-transparent hover:border-slate-300"
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

  const userInfoCapsuleDesktop = !isSuperAdmin ? (
    <div className="hidden min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 xl:flex">
      {activeOrgLogoUrl ? (
        <img
          src={activeOrgLogoUrl}
          alt="Logo organización"
          width={20}
          height={20}
          className="h-5 w-5 rounded-md object-cover"
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

  const userInfoCapsuleMobile = !isSuperAdmin ? (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 lg:hidden">
      {activeOrgLogoUrl ? (
        <img
          src={activeOrgLogoUrl}
          alt="Logo organización"
          width={18}
          height={18}
          className="h-[18px] w-[18px] rounded-md object-cover"
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
      <header className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className={cn("mx-auto grid gap-2 px-4 py-2", isDashboardHome ? "max-w-[1400px]" : "max-w-[1100px]")}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-2 whitespace-nowrap">
              {platformLogoUrl ? (
                <img
                  src={platformLogoUrl}
                  alt="Logo plataforma"
                  width={38}
                  height={38}
                  className="h-9 w-9 rounded-lg object-cover"
                />
              ) : null}
              <Link href={isSuperAdmin ? "/app/super-admin" : "/app"} className="truncate text-base font-semibold text-slate-900">
                OpsAhead
              </Link>
              {isSuperAdmin ? <Badge variant="secondary">Global</Badge> : null}
            </div>

            {isSuperAdmin ? (
              <div className="flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
                <Link href="/app/super-admin">
                  <Button variant="outline" size="sm" className="bg-transparent">
                    Panel global
                  </Button>
                </Link>
                <Button onClick={logout} variant="outline" size="sm" className="bg-transparent">
                  Salir
                </Button>
              </div>
            ) : isDashboardHome ? (
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:w-auto lg:flex-nowrap">
                <Link href="/app/entities?new=1" className="block">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-full bg-transparent sm:h-10 sm:w-10"
                    title="Nueva entidad"
                    aria-label="Nueva entidad"
                  >
                    <IconPlus />
                  </Button>
                </Link>
                <Link href="/app/settings/semaphore" className="block">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-full bg-transparent sm:h-10 sm:w-10"
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
                  className="h-11 w-full bg-transparent sm:h-10 sm:w-10"
                  title="Refrescar"
                  aria-label="Refrescar"
                >
                  <IconRefresh />
                </Button>
                <Link href="/app/entities" className="block">
                  <Button variant="outline" size="icon" className="h-11 w-full bg-transparent sm:h-10 sm:w-10" title="Menú" aria-label="Menú">
                    <IconMenu />
                  </Button>
                </Link>
                <Link href="/app/profile" className="block">
                  <Button variant="outline" size="icon" className="h-11 w-full bg-transparent sm:h-10 sm:w-10" title="Perfil" aria-label="Perfil">
                    <IconUser />
                  </Button>
                </Link>
                <Button
                  onClick={logout}
                  variant="outline"
                  size="icon"
                  className="h-11 w-full bg-transparent sm:h-10 sm:w-10"
                  title="Salir"
                  aria-label="Salir"
                >
                  <IconLogout />
                </Button>
                {userInfoCapsuleDesktop}
              </div>
            ) : (
              <div className="flex w-full min-w-0 flex-col gap-2 lg:flex-1 lg:flex-row lg:items-center lg:gap-2">
                <nav className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto p-1 lg:flex-1 lg:overflow-visible">
                  <NavLink href="/app" label="Dashboard" />
                  <NavLink href="/app/entities" label="Entidades" />
                  <NavLink href="/app/entity-types" label="Tipos entidad" />
                  <NavLink href="/app/deadline-types" label="Tipos vencimiento" />
                  <NavLink href="/app/users" label="Usuarios" />
                </nav>
                <div className="ml-auto flex w-full items-center justify-end gap-2 lg:w-auto lg:flex-nowrap">
                  <Link href="/app/profile">
                    <Button variant="outline" size="sm" className="bg-transparent">
                      Perfil
                    </Button>
                  </Link>
                  <Button onClick={logout} variant="outline" size="sm" className="bg-transparent">
                    Salir
                  </Button>
                  {userInfoCapsuleDesktop}
                </div>
              </div>
            )}
          </div>
          {!isSuperAdmin ? userInfoCapsuleMobile : null}
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
