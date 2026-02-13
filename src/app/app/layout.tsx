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
  const isDashboardHome = pathname === "/app";

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      const token = data.session?.access_token;
      const email = data.session?.user?.email || "";
      if (!cancelled) setSessionEmail(email);
      if (!token) return;

      const res = await fetch("/api/platform/super-admin/status", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const json = await res.json().catch(() => ({}));
      if (!cancelled) {
        setIsSuperAdmin(Boolean(json?.is_super_admin));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
              <Link href="/app" style={{ textDecoration: "none", color: "black" }}>
                <strong>Deadline Tracker</strong>
              </Link>
            </div>

            {isDashboardHome ? (
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
                {isSuperAdmin ? <NavLink href="/app/super-admin" label="Super Admin" /> : null}
                <button onClick={logout} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #eee" }}>
                  Salir
                </button>
              </nav>
            )}
          </div>
          {!isDashboardHome && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Sesión: {sessionEmail || "(sin email)"}
              {isSuperAdmin ? " · super admin" : ""}
            </div>
          )}
        </div>
      </header>

      <div style={{ flex: 1 }}>{children}</div>

      <footer style={{ borderTop: "1px solid #eee", padding: "14px 16px", background: "white" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", fontSize: 12, opacity: 0.7 }}>
          v2 · Fase: Optimización UX/UI + validación integral de flujos
        </div>
      </footer>
    </div>
  );
}
