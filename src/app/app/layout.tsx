"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { supabaseAuth } from "@/lib/supabase/authClient";

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/app" && pathname.startsWith(href + "/"));
  return (
    <Link
      href={href}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        textDecoration: "none",
        color: "black",
        background: active ? "#f2f2f2" : "transparent",
        border: active ? "1px solid #e5e5e5" : "1px solid transparent",
      }}
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

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "white", borderBottom: "1px solid #eee" }}>
        <div
          style={{
            maxWidth: isDashboardHome ? 1400 : 1100,
            margin: "0 auto",
            padding: isDashboardHome ? "8px 16px" : "10px 16px 8px",
            display: "grid",
            gap: isDashboardHome ? 0 : 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, whiteSpace: "nowrap" }}>
              {platformLogoUrl ? (
                <img
                  src={platformLogoUrl}
                  alt="Logo plataforma"
                  width={38}
                  height={38}
                  style={{ width: 38, height: 38, borderRadius: 8, objectFit: "cover", border: "1px solid #e5e5e5" }}
                />
              ) : null}
              <Link href={isSuperAdmin ? "/app/super-admin" : "/app"} style={{ textDecoration: "none", color: "black" }}>
                <strong>OpsAhead</strong>
              </Link>
              {!isSuperAdmin && activeOrgLogoUrl ? (
                <img
                  src={activeOrgLogoUrl}
                  alt="Logo organización"
                  width={24}
                  height={24}
                  style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover", border: "1px solid #e5e5e5" }}
                />
              ) : null}
              {!isSuperAdmin && activeOrgName ? (
                <span style={{ fontSize: 12, opacity: 0.75 }}>· {activeOrgName}</span>
              ) : null}
            </div>

            {isSuperAdmin ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Link href="/app/super-admin" style={{ textDecoration: "none" }}>
                  <button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #eee", background: "white" }}>
                    Panel global
                  </button>
                </Link>
                <button onClick={logout} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #eee" }}>
                  Salir
                </button>
              </div>
            ) : isDashboardHome ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Link href="/app/entities" style={{ textDecoration: "none" }}>
                  <button style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #eee", background: "white" }}>
                    Menú
                  </button>
                </Link>
                <button onClick={logout} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #eee" }}>
                  Salir
                </button>
              </div>
            ) : (
              <nav style={{ display: "flex", gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
                <NavLink href="/app" label="Dashboard" />
                <NavLink href="/app/entities" label="Entidades" />
                <NavLink href="/app/entity-types" label="Tipos entidad" />
                <NavLink href="/app/deadline-types" label="Tipos vencimiento" />
                <NavLink href="/app/users" label="Usuarios" />
                <NavLink href="/app/profile" label="Perfil" />
                <button onClick={logout} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #eee" }}>
                  Salir
                </button>
              </nav>
            )}
          </div>
          {!isDashboardHome && !isSuperAdmin && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Sesión: {sessionEmail || "(sin email)"}
            </div>
          )}
        </div>
      </header>

      <div style={{ flex: 1 }}>
        {isSuperAdminLockedOutRoute ? <p style={{ padding: 16 }}>Redirigiendo al panel global…</p> : children}
      </div>

      <footer style={{ borderTop: "1px solid #eee", padding: "14px 16px", background: "white" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", fontSize: 12, opacity: 0.7 }}>
          v2 · Fase: Optimización UX/UI + validación integral de flujos
        </div>
      </footer>
    </div>
  );
}
