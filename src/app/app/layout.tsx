"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { cn } from "@/lib/utils";

type ModuleKey =
  | "analytics_dashboard"
  | "operations_dashboard"
  | "forecast"
  | "alerts"
  | "entities"
  | "reports_usage"
  | "semaphore"
  | "entity_types"
  | "deadline_types"
  | "usage_units"
  | "usage_capture"
  | "bi_integrations"
  | "users";

type NavItem = {
  href: string;
  label: string;
  moduleKey: ModuleKey;
  icon: React.ReactNode;
};

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

function IconHome({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

function IconForecast({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 3v18h18" />
      <path d="m7 15 4-4 3 3 5-6" />
    </svg>
  );
}

function IconAlert({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}

function IconEntities({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="6" rx="1.5" />
      <rect x="3" y="14" width="18" height="6" rx="1.5" />
    </svg>
  );
}

function IconUsage({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 12h16" />
      <path d="m14 6 6 6-6 6" />
      <circle cx="7" cy="12" r="3" />
    </svg>
  );
}

function IconTag({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20.59 13.41 11 3H4v7l9.59 9.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82z" />
      <circle cx="7.5" cy="7.5" r="1.5" />
    </svg>
  );
}

function IconUsers({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="9" cy="7" r="3" />
      <circle cx="17" cy="9" r="2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M15 20a4 4 0 0 1 6 0" />
    </svg>
  );
}

function IconReport({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h8" />
      <path d="M8 9h2" />
    </svg>
  );
}

function IconMenu({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

function NavLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/app" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl border bg-transparent text-sm text-slate-700 transition-colors sm:h-10 sm:w-10",
        active ? "border-slate-300 text-slate-900" : "border-transparent hover:border-slate-300"
      )}
    >
      {icon}
    </Link>
  );
}

const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Dashboard", moduleKey: "analytics_dashboard", icon: <IconHome /> },
  { href: "/app/operations", label: "Operaciones", moduleKey: "operations_dashboard", icon: <IconEntities /> },
  { href: "/app/forecast", label: "Forecast", moduleKey: "forecast", icon: <IconForecast /> },
  { href: "/app/alerts", label: "Alertas", moduleKey: "alerts", icon: <IconAlert /> },
  { href: "/app/entities", label: "Entidades", moduleKey: "entities", icon: <IconEntities /> },
  { href: "/app/usage-capture", label: "Captura uso", moduleKey: "usage_capture", icon: <IconUsage /> },
  { href: "/app/bi-integrations", label: "Integraciones BI", moduleKey: "bi_integrations", icon: <IconReport /> },
  { href: "/app/reports/usage", label: "Reportes uso", moduleKey: "reports_usage", icon: <IconReport /> },
  { href: "/app/settings/semaphore", label: "Semáforo", moduleKey: "semaphore", icon: <IconTraffic /> },
  { href: "/app/entity-types", label: "Tipos entidad", moduleKey: "entity_types", icon: <IconTag /> },
  { href: "/app/deadline-types", label: "Tipos vencimiento", moduleKey: "deadline_types", icon: <IconTag /> },
  { href: "/app/usage-units", label: "Unidades uso", moduleKey: "usage_units", icon: <IconTag /> },
  { href: "/app/users", label: "Usuarios", moduleKey: "users", icon: <IconUsers /> },
];

function getModuleByPath(pathname: string): ModuleKey | null {
  if (pathname === "/app") return "analytics_dashboard";
  if (pathname.startsWith("/app/operations")) return "operations_dashboard";
  if (pathname.startsWith("/app/forecast")) return "forecast";
  if (pathname.startsWith("/app/alerts")) return "alerts";
  if (pathname.startsWith("/app/entities")) return "entities";
  if (pathname.startsWith("/app/usage-capture")) return "usage_capture";
  if (pathname.startsWith("/app/bi-integrations")) return "bi_integrations";
  if (pathname.startsWith("/app/reports/usage")) return "reports_usage";
  if (pathname.startsWith("/app/settings/semaphore")) return "semaphore";
  if (pathname.startsWith("/app/entity-types")) return "entity_types";
  if (pathname.startsWith("/app/deadline-types")) return "deadline_types";
  if (pathname.startsWith("/app/usage-units")) return "usage_units";
  if (pathname.startsWith("/app/users")) return "users";
  return null;
}

function getRouteByModule(moduleKey: ModuleKey): string {
  if (moduleKey === "analytics_dashboard") return "/app";
  if (moduleKey === "operations_dashboard") return "/app/operations";
  if (moduleKey === "forecast") return "/app/forecast";
  if (moduleKey === "alerts") return "/app/alerts";
  if (moduleKey === "entities") return "/app/entities";
  if (moduleKey === "usage_capture") return "/app/usage-capture";
  if (moduleKey === "bi_integrations") return "/app/bi-integrations";
  if (moduleKey === "reports_usage") return "/app/reports/usage";
  if (moduleKey === "semaphore") return "/app/settings/semaphore";
  if (moduleKey === "entity_types") return "/app/entity-types";
  if (moduleKey === "deadline_types") return "/app/deadline-types";
  if (moduleKey === "usage_units") return "/app/usage-units";
  return "/app/users";
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false);
  const [sessionEmail, setSessionEmail] = React.useState("");
  const [platformLogoUrl, setPlatformLogoUrl] = React.useState("");
  const [activeOrgName, setActiveOrgName] = React.useState("");
  const [activeOrgLogoUrl, setActiveOrgLogoUrl] = React.useState("");
  const [allowedModules, setAllowedModules] = React.useState<Set<string> | null>(null);
  const [moduleAccessLoaded, setModuleAccessLoaded] = React.useState(false);
  const [mobileHeaderMenuOpen, setMobileHeaderMenuOpen] = React.useState(false);
  const [frontendRev, setFrontendRev] = React.useState("...");
  const [backendRev, setBackendRev] = React.useState("...");
  const [deployEnv, setDeployEnv] = React.useState("...");
  const isSuperAdminArea = pathname.startsWith("/app/super-admin");
  const isSuperAdminLockedOutRoute = isSuperAdmin && !isSuperAdminArea;

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setModuleAccessLoaded(false);

        const { data } = await supabaseAuth.auth.getSession();
        let session = data.session;
        if (!session?.access_token) {
          const refresh = await supabaseAuth.auth.refreshSession();
          session = refresh.data.session ?? null;
        }

        const token = session?.access_token;
        const email = session?.user?.email || "";
        if (!cancelled) setSessionEmail(email);

        if (!token) {
          if (!cancelled) {
            setIsSuperAdmin(false);
            setPlatformLogoUrl("");
            setActiveOrgName("");
            setActiveOrgLogoUrl("");
            setAllowedModules(null);
            setModuleAccessLoaded(true);
          }
          router.replace("/login");
          return;
        }

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
        if (cancelled) return;

        const currentIsSuperAdmin = Boolean(json?.is_super_admin);
        setPlatformLogoUrl(platformJson?.platform?.logo_url ?? "");
        setIsSuperAdmin(currentIsSuperAdmin);
        if (!currentIsSuperAdmin) {
          const [orgRes, accessRes] = await Promise.all([
            fetch("/api/orgs/active", {
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetch("/api/me/module-access", {
              headers: { Authorization: `Bearer ${token}` },
            }),
          ]);
          const orgJson = await orgRes.json().catch(() => ({}));
          const accessJson = await accessRes.json().catch(() => ({}));
          if (cancelled) return;
          setActiveOrgName(orgJson?.organization?.name ?? "");
          setActiveOrgLogoUrl(orgJson?.organization?.logo_url ?? "");
          if (accessRes.ok && Array.isArray(accessJson?.allowed_modules)) {
            const modules = new Set<string>(accessJson.allowed_modules.map((v: unknown) => String(v)));
            if (modules.has("dashboard")) {
              modules.add("analytics_dashboard");
              modules.add("operations_dashboard");
            }
            setAllowedModules(modules);
          } else {
            setAllowedModules(null);
          }
          setModuleAccessLoaded(true);
        } else {
          setActiveOrgName("");
          setActiveOrgLogoUrl("");
          setAllowedModules(null);
          setModuleAccessLoaded(true);
        }
        if (currentIsSuperAdmin && pathname && !pathname.startsWith("/app/super-admin")) {
          router.replace("/app/super-admin");
        }
      } catch {
        if (!cancelled) {
          setSessionEmail("");
          setIsSuperAdmin(false);
          setPlatformLogoUrl("");
          setActiveOrgName("");
          setActiveOrgLogoUrl("");
          setAllowedModules(null);
          setModuleAccessLoaded(true);
        }
        router.replace("/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  React.useEffect(() => {
    if (isSuperAdmin || !allowedModules) return;
    const routeModule = getModuleByPath(pathname);
    if (routeModule && !allowedModules.has(routeModule)) {
      const nextItem = NAV_ITEMS.find((item) => allowedModules.has(item.moduleKey));
      if (!nextItem) {
        router.replace("/select-org");
        return;
      }
      router.replace(getRouteByModule(nextItem.moduleKey));
    }
  }, [allowedModules, isSuperAdmin, pathname, router]);

  React.useEffect(() => {
    setMobileHeaderMenuOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/platform/version", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (!res.ok) {
        setFrontendRev("n/a");
        setBackendRev("n/a");
        setDeployEnv("n/a");
        return;
      }
      setFrontendRev(String(json?.frontend_rev ?? "n/a"));
      setBackendRev(String(json?.backend_rev ?? "n/a"));
      setDeployEnv(String(json?.environment ?? "n/a"));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleNavItems = React.useMemo(() => {
    if (!moduleAccessLoaded && !isSuperAdmin) return [];
    if (!allowedModules) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => allowedModules.has(item.moduleKey));
  }, [allowedModules, isSuperAdmin, moduleAccessLoaded]);


  async function logout() {
    await supabaseAuth.auth.signOut();
    router.replace("/login");
  }

  function refreshApp() {
    if ((pathname === "/app" || pathname.startsWith("/app/operations")) && typeof window !== "undefined") {
      window.dispatchEvent(new Event("dashboard-refresh"));
      return;
    }
    router.refresh();
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
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
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
    <div className="app-shell flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 px-2 py-2 backdrop-blur sm:px-3">
        <div className={cn("mx-auto", isSuperAdmin ? "max-w-[1100px]" : "max-w-[1400px]")}>
          <div
            className="flex flex-col gap-2 px-4 py-2 lg:flex-row lg:items-center lg:justify-between"
            style={{
              background: "linear-gradient(120deg, rgba(236, 253, 245, 0.8), rgba(239, 246, 255, 0.9), rgba(255, 255, 255, 1))",
              border: "1px solid #d6e0ea",
              borderRadius: "14px",
              boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              {platformLogoUrl ? (
                <img
                  src={platformLogoUrl}
                  alt="Logo plataforma"
                  width={38}
                  height={38}
                  className="h-11 w-11 rounded-lg object-cover sm:h-9 sm:w-9"
                />
              ) : null}
              <Link href={isSuperAdmin ? "/app/super-admin" : "/app"} className="min-w-0 truncate text-base font-semibold text-slate-900 sm:text-base">
                OpsAhead
              </Link>
              {isSuperAdmin ? <Badge variant="secondary" className="shrink-0">Global</Badge> : null}
              {!isSuperAdmin ? <div className="min-w-0 flex-1 lg:hidden">{userInfoCapsuleMobile}</div> : null}
              {!isSuperAdmin ? (
                <div className="shrink-0 lg:hidden">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setMobileHeaderMenuOpen(true)}
                    className="h-11 w-11 px-0 bg-transparent"
                    aria-label="Abrir menú"
                    title="Menú"
                  >
                    <IconMenu className="h-6 w-6" />
                  </Button>
                </div>
              ) : null}
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
            ) : (
              <div className="flex w-full min-w-0 flex-col gap-2 lg:flex-1 lg:flex-row lg:items-center lg:gap-2">
                <nav className="hidden min-w-0 flex-nowrap items-center gap-1 overflow-x-auto p-1 lg:flex lg:flex-1 lg:overflow-visible">
                  {visibleNavItems.map((item) => (
                    <NavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
                  ))}
                </nav>
                <div className="hidden min-w-0 items-center gap-2 lg:flex lg:flex-nowrap">
                  <Button
                    onClick={refreshApp}
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 bg-transparent sm:h-10 sm:w-10"
                    title="Refrescar"
                    aria-label="Refrescar"
                  >
                    <IconRefresh />
                  </Button>
                  <Link href="/app/profile" className="block">
                    <Button variant="outline" size="icon" className="h-9 w-9 bg-transparent sm:h-10 sm:w-10" title="Perfil" aria-label="Perfil">
                      <IconUser />
                    </Button>
                  </Link>
                  <Button
                    onClick={logout}
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 bg-transparent sm:h-10 sm:w-10"
                    title="Salir"
                    aria-label="Salir"
                  >
                    <IconLogout />
                  </Button>
                  {userInfoCapsuleDesktop}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {mobileHeaderMenuOpen ? (
        <div className="fixed inset-0 z-[120] bg-slate-900/35 lg:hidden" onClick={() => setMobileHeaderMenuOpen(false)}>
          <aside
            className="absolute right-0 top-0 flex h-full w-72 max-w-[90vw] flex-col border-l bg-white p-3 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">Menú</div>
              <Button
                onClick={() => setMobileHeaderMenuOpen(false)}
                variant="outline"
                size="sm"
                className="h-8 bg-transparent"
                aria-label="Cerrar menú"
                title="Cerrar"
              >
                Cerrar
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-1">
                {visibleNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileHeaderMenuOpen(false)}
                    className="inline-flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-sm text-slate-700 hover:border-slate-300"
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="mt-3 border-t pt-3">
              <div className="grid gap-1">
                <Button
                  onClick={() => {
                    setMobileHeaderMenuOpen(false);
                    refreshApp();
                  }}
                  variant="outline"
                  size="sm"
                  className="h-9 justify-start bg-transparent"
                  title="Refrescar"
                  aria-label="Refrescar"
                >
                  <IconRefresh className="mr-2 h-4 w-4" />
                  Refrescar
                </Button>
                <Link href="/app/profile" className="block" onClick={() => setMobileHeaderMenuOpen(false)}>
                  <Button variant="outline" size="sm" className="h-9 w-full justify-start bg-transparent" title="Perfil" aria-label="Perfil">
                    <IconUser className="mr-2 h-4 w-4" />
                    Perfil
                  </Button>
                </Link>
                <Button
                  onClick={logout}
                  variant="outline"
                  size="sm"
                  className="h-9 justify-start bg-transparent"
                  title="Salir"
                  aria-label="Salir"
                >
                  <IconLogout className="mr-2 h-4 w-4" />
                  Salir
                </Button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="app-content flex-1">
        {isSuperAdminLockedOutRoute ? (
          <div className="flex justify-center p-4">
            <Loader label="Redirigiendo al panel global..." />
          </div>
        ) : !isSuperAdmin && !moduleAccessLoaded ? (
          <div className="flex justify-center p-4">
            <Loader label="Cargando permisos..." />
          </div>
        ) : (
          children
        )}
      </div>

      <footer className="border-t bg-white px-4 py-3">
        <div className={cn("mx-auto text-xs text-slate-500", isSuperAdmin ? "max-w-[1100px]" : "max-w-[1400px]")}>
          {deployEnv === "production"
            ? `v2 · Dashboard analítico y Operaciones separadas, con control de acceso por módulo y captura de uso dinámica. · UI ${frontendRev || "n/a"} · API ${backendRev || "n/a"} · production`
            : "v2 · Dashboard analítico y Operaciones separadas, con control de acceso por módulo y captura de uso dinámica."}
        </div>
      </footer>
    </div>
  );
}
