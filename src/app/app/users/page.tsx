"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type Role = "admin" | "member" | "viewer" | "owner";

type MemberRow = {
  user_id: string;
  email: string;
  role: Role;
  created_at: string;
};

export default function UsersAdminPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [members, setMembers] = useState<MemberRow[]>([]);

  useEffect(() => {
    void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function loadMembers() {
    setLoading(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/admin/members", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json.error || "No se pudieron cargar miembros (¿eres admin/owner?)");
      setMembers([]);
      setLoading(false);
      return;
    }

    setMembers(Array.isArray(json.members) ? json.members : []);
    setLoading(false);
  }

  async function invite() {
    setBusy(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Email requerido");
      setBusy(false);
      return;
    }

    const res = await fetch("/api/admin/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: cleanEmail, role }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json.error || "No se pudo invitar");
      setBusy(false);
      return;
    }

    setMessage("Invitación enviada y miembro registrado (si aplica).");
    setEmail("");
    setBusy(false);
    await loadMembers();
  }

  async function removeAccess(userId: string, display: string) {
    const ok = confirm(`¿Quitar acceso a: ${display} ?`);
    if (!ok) return;

    setBusy(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/admin/members/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ userId }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudo quitar el acceso");
      setBusy(false);
      return;
    }

    setMessage("Acceso removido.");
    setBusy(false);
    await loadMembers();
  }

  return (
    <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
      <h2>Usuarios</h2>
      <p style={{ opacity: 0.75, marginTop: 6 }}>
        Invita usuarios por correo y gestiona accesos de esta organización.
      </p>

      {(error || message) && (
        <div style={{ marginTop: 12 }}>
          {error && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</p>}
          {message && <p style={{ color: "green", whiteSpace: "pre-wrap" }}>{message}</p>}
        </div>
      )}

      <section style={{ marginTop: 16, border: "1px solid #eee", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Invitar usuario</h3>

        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label>Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="persona@empresa.com"
              type="email"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            />
          </div>

          <div>
            <label>Rol</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            >
              <option value="admin">admin</option>
              <option value="member">member</option>
              <option value="viewer">viewer</option>
            </select>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
              owner se asigna solo al creador de la organización.
            </div>
          </div>

          <button onClick={invite} disabled={busy} style={{ padding: 12, width: "100%" }}>
            {busy ? "Invitando..." : "Invitar"}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 16, border: "1px solid #eee", padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ marginTop: 0 }}>Miembros</h3>
          <button onClick={loadMembers} disabled={busy || loading} style={{ padding: 10 }}>
            {loading ? "Cargando..." : "Refrescar"}
          </button>
        </div>

        {loading ? (
          <p>Cargando miembros...</p>
        ) : members.length === 0 ? (
          <p style={{ opacity: 0.75 }}>
            No hay miembros para mostrar (o no tienes permisos admin/owner).
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                    Email
                  </th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                    Rol
                  </th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                    user_id
                  </th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                    Creado
                  </th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const display = m.email || m.user_id;
                  const isOwner = m.role === "owner";

                  return (
                    <tr key={m.user_id}>
                      <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                        {m.email || <span style={{ opacity: 0.6 }}>(sin email)</span>}
                      </td>
                      <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{m.role}</td>
                      <td
                        style={{
                          borderBottom: "1px solid #f3f3f3",
                          padding: 8,
                          fontFamily: "monospace",
                          fontSize: 12,
                          opacity: 0.85,
                        }}
                      >
                        {m.user_id}
                      </td>
                      <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                      <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                        <button
                          onClick={() => removeAccess(m.user_id, display)}
                          disabled={busy || isOwner}
                          style={{ padding: 8 }}
                          title={isOwner ? "No se puede remover al owner" : "Quitar acceso"}
                        >
                          Quitar acceso
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
