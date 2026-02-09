"use client";

import Link from "next/link";

export default function AppHomePage() {
  const cardStyle: React.CSSProperties = {
    border: "1px solid #eee",
    borderRadius: 14,
    padding: 16,
    textDecoration: "none",
    color: "black",
    background: "white",
  };

  return (
    <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ marginTop: 10 }}>Dashboard</h2>
      <p style={{ opacity: 0.75, marginTop: 6 }}>Navega por los módulos principales.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, marginTop: 16 }}>
        <Link href="/app/entities" style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Entidades</h3>
          <p style={{ margin: 0, opacity: 0.75 }}>Crea y gestiona entidades. Accede a su ficha y vencimientos.</p>
        </Link>

        <Link href="/app/entity-types" style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Tipos de entidad</h3>
          <p style={{ margin: 0, opacity: 0.75 }}>Configura tipos y campos personalizados.</p>
        </Link>

        <Link href="/app/deadline-types" style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Tipos de vencimiento</h3>
          <p style={{ margin: 0, opacity: 0.75 }}>Define el catálogo de vencimientos (por fecha / por uso).</p>
        </Link>

        <Link href="/app/users" style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Usuarios</h3>
          <p style={{ margin: 0, opacity: 0.75 }}>Invita y gestiona miembros de la organización.</p>
        </Link>
      </div>
    </main>
  );
}
