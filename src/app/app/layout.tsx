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

  async function logout() {
    await supabaseAuth.auth.signOut();
    router.replace("/login");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ position: "sticky", top: 0, zIndex: 10, background: "white", borderBottom: "1px solid #eee" }}>
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <Link href="/app" style={{ textDecoration: "none", color: "black" }}>
            <strong>Deadline Tracker</strong>
          </Link>

          <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <NavLink href="/app" label="Dashboard" />
            <NavLink href="/app/entities" label="Entidades" />
            <NavLink href="/app/entity-types" label="Tipos entidad" />
            <NavLink href="/app/deadline-types" label="Tipos vencimiento" />
            <NavLink href="/app/users" label="Usuarios" />
            <button onClick={logout} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #eee" }}>
              Salir
            </button>
          </nav>
        </div>
      </header>

      <div style={{ flex: 1 }}>{children}</div>

      <footer style={{ borderTop: "1px solid #eee", padding: "14px 16px", background: "white" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", fontSize: 12, opacity: 0.7 }}>v0 · Fase 2.1</div>
      </footer>
    </div>
  );
}
