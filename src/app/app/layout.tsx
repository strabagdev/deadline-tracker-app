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

type SectionKey = "home" | "operations" | "risk" | "reports" | "settings";

type PrimaryNavItem = {
  key: SectionKey;
  label: string;
  icon: React.ReactNode;
};

type SecondaryNavItem = {
  href: string;
  label: string;
  moduleKey: ModuleKey;
  sectionKey: SectionKey;
  icon: React.ReactNode;
};

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

function IconSettings({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 1-2 0 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 1 0-2 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 1 2 0 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .38.14.74.4 1a1.65 1.65 0 0 1 0 2c-.26.26-.4.62-.4 1Z" />
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

function PrimaryNavLink({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-all",
        active
          ? "bg-slate-900 text-white shadow-[0_10px_24px_-18px_rgba(15,23,42,0.8)]"
          : "text-slate-600 hover:bg-white/75 hover:text-slate-900"
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

function SecondaryNavLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/app" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm transition-all",
        active
          ? "bg-white text-slate-900 shadow-[0_8px_18px_-16px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/80"
          : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { key: "home", label: "Inicio", icon: <IconHome /> },
  { key: "operations", label: "Operacion", icon: <IconEntities /> },
  { key: "risk", label: "Riesgo", icon: <IconAlert /> },
  { key: "reports", label: "Reportes", icon: <IconReport /> },
  { key: "settings", label: "Configuracion", icon: <IconSettings /> },
];

const SECONDARY_NAV_ITEMS: SecondaryNavItem[] = [
  { href: "/app", label: "Resumen", moduleKey: "analytics_dashboard", sectionKey: "home", icon: <IconHome /> },
  { href: "/app/operations", label: "Vista operativa", moduleKey: "operations_dashboard", sectionKey: "operations", icon: <IconEntities /> },
  { href: "/app/entities", label: "Entidades", moduleKey: "entities", sectionKey: "operations", icon: <IconEntities /> },
  { href: "/app/usage-capture", label: "Captura de uso", moduleKey: "usage_capture", sectionKey: "operations", icon: <IconUsage /> },
  { href: "/app/forecast", label: "Forecast", moduleKey: "forecast", sectionKey: "risk", icon: <IconForecast /> },
  { href: "/app/alerts", label: "Alertas", moduleKey: "alerts", sectionKey: "risk", icon: <IconAlert /> },
  { href: "/app/reports/deadlines", label: "Vencimientos", moduleKey: "reports_usage", sectionKey: "reports", icon: <IconReport /> },
  { href: "/app/reports/usage", label: "Uso", moduleKey: "reports_usage", sectionKey: "reports", icon: <IconUsage /> },
  { href: "/app/entity-types", label: "Tipos de entidad", moduleKey: "entity_types", sectionKey: "settings", icon: <IconTag /> },
  { href: "/app/deadline-types", label: "Tipos de vencimiento", moduleKey: "deadline_types", sectionKey: "settings", icon: <IconTag /> },
  { href: "/app/usage-units", label: "Unidades de uso", moduleKey: "usage_units", sectionKey: "settings", icon: <IconUsage /> },
  { href: "/app/settings/semaphore", label: "Semaforo", moduleKey: "semaphore", sectionKey: "settings", icon: <IconAlert /> },
  { href: "/app/users", label: "Usuarios", moduleKey: "users", sectionKey: "settings", icon: <IconUsers /> },
  { href: "/app/bi-integrations", label: "Integraciones BI", moduleKey: "bi_integrations", sectionKey: "settings", icon: <IconReport /> },
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
  if (pathname.startsWith("/app/reports/deadlines")) return "reports_usage";
  if (pathname.startsWith("/app/settings/semaphore")) return "semaphore";
  if (pathname.startsWith("/app/entity-types")) return "entity_types";
  if (pathname.startsWith("/app/deadline-types")) return "deadline_types";
  if (pathname.startsWith("/app/usage-units")) return "usage_units";
  if (pathname.startsWith("/app/users")) return "users";
  return null;
}

function getSectionByPath(pathname: string): SectionKey | null {
  if (pathname === "/app" || pathname.startsWith("/app/profile")) return "home";
  if (pathname.startsWith("/app/operations") || pathname.startsWith("/app/entities") || pathname.startsWith("/app/usage-capture")) return "operations";
  if (pathname.startsWith("/app/forecast") || pathname.startsWith("/app/alerts")) return "risk";
  if (pathname.startsWith("/app/reports")) return "reports";
  if (
    pathname.startsWith("/app/entity-types") ||
    pathname.startsWith("/app/deadline-types") ||
    pathname.startsWith("/app/usage-units") ||
    pathname.startsWith("/app/settings/semaphore") ||
    pathname.startsWith("/app/users") ||
    pathname.startsWith("/app/bi-integrations")
  ) return "settings";
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
  if (moduleKey === "reports_usage") return "/app/reports/deadlines";
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

        const bootstrapRes = await fetch("/api/app/bootstrap", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const bootstrapJson = await bootstrapRes.json().catch(() => ({}));
        if (cancelled) return;
        if (!bootstrapRes.ok) {
          throw new Error(String(bootstrapJson?.error || "No se pudo cargar el contexto inicial"));
        }

        const currentIsSuperAdmin = Boolean(bootstrapJson?.access?.is_super_admin);
        setPlatformLogoUrl(bootstrapJson?.platform?.logo_url ?? "");
        setIsSuperAdmin(currentIsSuperAdmin);
        if (!currentIsSuperAdmin) {
          setActiveOrgName(bootstrapJson?.access?.active_organization?.name ?? "");
          setActiveOrgLogoUrl(bootstrapJson?.access?.active_organization?.logo_url ?? "");
          if (Array.isArray(bootstrapJson?.access?.allowed_modules)) {
            const modules = new Set<string>(bootstrapJson.access.allowed_modules.map((v: unknown) => String(v)));
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
      const nextItem = SECONDARY_NAV_ITEMS.find((item) => allowedModules.has(item.moduleKey));
      if (!nextItem) {
        router.replace("/select-org");
        return;
      }
      router.replace(nextItem.href || getRouteByModule(nextItem.moduleKey));
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

  const visibleSecondaryNavItems = React.useMemo(() => {
    if (!moduleAccessLoaded && !isSuperAdmin) return [];
    if (!allowedModules) return SECONDARY_NAV_ITEMS;
    return SECONDARY_NAV_ITEMS.filter((item) => allowedModules.has(item.moduleKey));
  }, [allowedModules, isSuperAdmin, moduleAccessLoaded]);

  const activeSection = React.useMemo(() => getSectionByPath(pathname), [pathname]);
  const visiblePrimaryNavItems = React.useMemo(
    () =>
      PRIMARY_NAV_ITEMS.filter((section) =>
        visibleSecondaryNavItems.some((item) => item.sectionKey === section.key)
      ),
    [visibleSecondaryNavItems]
  );
  const visibleSecondaryItemsBySection = React.useMemo(() => {
    const grouped = new Map<SectionKey, SecondaryNavItem[]>();
    for (const item of visibleSecondaryNavItems) {
      const list = grouped.get(item.sectionKey) ?? [];
      list.push(item);
      grouped.set(item.sectionKey, list);
    }
    return grouped;
  }, [visibleSecondaryNavItems]);
  const activeSectionItems = activeSection ? (visibleSecondaryItemsBySection.get(activeSection) ?? []) : [];
  const sectionHrefByKey = React.useMemo(() => {
    const entries = PRIMARY_NAV_ITEMS.map((section) => {
      const firstVisible = visibleSecondaryNavItems.find((item) => item.sectionKey === section.key);
      return [section.key, firstVisible?.href ?? "/app"] as const;
    });
    return new Map<SectionKey, string>(entries);
  }, [visibleSecondaryNavItems]);

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
    <div className="hidden min-w-0 items-center gap-2 rounded-full bg-white/70 px-2.5 py-1.5 ring-1 ring-slate-200/70 backdrop-blur-sm xl:flex">
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
    <div className="flex min-w-0 items-center gap-2 rounded-full bg-white/70 px-2.5 py-1.5 ring-1 ring-slate-200/70 backdrop-blur-sm">
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
            className="flex flex-col gap-3 px-4 py-3"
            style={{
              background: "linear-gradient(125deg, rgba(241, 248, 245, 0.96), rgba(246, 250, 253, 0.98), rgba(255, 255, 255, 1))",
              border: "1px solid rgba(212, 222, 230, 0.92)",
              borderRadius: "18px",
              boxShadow: "0 20px 36px -32px rgba(15, 23, 42, 0.28)",
            }}
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
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
                <div className="min-w-0">
                  <Link href={isSuperAdmin ? "/app/super-admin" : "/app"} className="min-w-0 truncate text-base font-semibold text-slate-900 sm:text-base">
                    OpsAhead
                  </Link>
                  {!isSuperAdmin ? <div className="hidden text-xs text-slate-500 lg:block">Navegacion simplificada por flujo de trabajo</div> : null}
                </div>
                {isSuperAdmin ? <Badge variant="secondary" className="shrink-0">Global</Badge> : null}
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
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 lg:hidden">{userInfoCapsuleMobile}</div>
                  <div className="shrink-0 lg:hidden">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMobileHeaderMenuOpen(true)}
                      className="h-11 w-11 rounded-full border-white/70 bg-white/70 px-0 shadow-none backdrop-blur-sm"
                      aria-label="Abrir menú"
                      title="Menú"
                    >
                      <IconMenu className="h-6 w-6" />
                    </Button>
                  </div>
                  <div className="hidden min-w-0 items-center gap-2 lg:flex lg:flex-nowrap">
                    <Button
                      onClick={refreshApp}
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full border-white/70 bg-white/70 shadow-none backdrop-blur-sm sm:h-10 sm:w-10"
                      title="Refrescar"
                      aria-label="Refrescar"
                    >
                      <IconRefresh />
                    </Button>
                    <Link href="/app/profile" className="block">
                      <Button variant="outline" size="icon" className="h-9 w-9 rounded-full border-white/70 bg-white/70 shadow-none backdrop-blur-sm sm:h-10 sm:w-10" title="Perfil" aria-label="Perfil">
                        <IconUser />
                      </Button>
                    </Link>
                    <Button
                      onClick={logout}
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-full border-white/70 bg-white/70 shadow-none backdrop-blur-sm sm:h-10 sm:w-10"
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

            {!isSuperAdmin ? (
              <div className="hidden lg:block">
                <nav className="flex flex-wrap items-center gap-2 rounded-full bg-white/55 p-1.5 ring-1 ring-white/85 backdrop-blur-md">
                  {visiblePrimaryNavItems.map((item) => (
                    <PrimaryNavLink
                      key={item.key}
                      href={sectionHrefByKey.get(item.key) ?? "/app"}
                      label={item.label}
                      icon={item.icon}
                      active={activeSection === item.key}
                    />
                  ))}
                </nav>
                {activeSectionItems.length > 1 ? (
                  <nav className="mt-2 flex flex-wrap items-center gap-2 pl-1">
                    {activeSectionItems.map((item) => (
                      <SecondaryNavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
                    ))}
                  </nav>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {mobileHeaderMenuOpen ? (
        <div className="fixed inset-0 z-[120] bg-slate-900/35 lg:hidden" onClick={() => setMobileHeaderMenuOpen(false)}>
          <aside
            className="absolute right-0 top-0 flex h-full w-72 max-w-[90vw] flex-col border-l border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,1))] p-3 shadow-xl"
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
              <div className="grid gap-4">
                {visiblePrimaryNavItems.map((section) => {
                  const items = visibleSecondaryItemsBySection.get(section.key) ?? [];
                  if (items.length === 0) return null;
                  return (
                    <div key={section.key} className="grid gap-1">
                      <div className="px-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        {section.label}
                      </div>
                      {items.map((item) => {
                        const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(item.href + "/"));
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileHeaderMenuOpen(false)}
                            className={cn(
                              "inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm transition-all",
                              active
                                ? "bg-slate-900 text-white"
                                : "text-slate-700 hover:bg-slate-100"
                            )}
                          >
                            {item.icon}
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  );
                })}
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
          <div className="flex min-h-[60vh] items-center justify-center p-4">
            <Loader label="Redirigiendo al panel global..." />
          </div>
        ) : !isSuperAdmin && !moduleAccessLoaded ? (
          <div className="flex min-h-[60vh] items-center justify-center p-4">
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
