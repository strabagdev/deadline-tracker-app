"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { USAGE_CAPTURE_SUBMODULE_PREFIX } from "@/lib/access/moduleKeys";

type Role = "admin" | "member" | "viewer" | "owner";

type MemberRow = {
  user_id: string;
  email: string;
  role: Role;
  member_type_id?: string | null;
  member_type_name?: string | null;
  created_at: string;
};

type MemberType = {
  id: string;
  name: string;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  modules: Array<{ module_key: string; can_view: boolean }>;
};
type UsageCaptureSubmodule = {
  module_key: string;
  entity_type_id: string;
  entity_type_name: string;
};

const MODULE_KEYS = [
  "analytics_dashboard",
  "operations_dashboard",
  "forecast",
  "alerts",
  "entities",
  "reports_usage",
  "semaphore",
  "entity_types",
  "deadline_types",
  "usage_units",
  "usage_capture",
  "bi_integrations",
  "users",
] as const;

export default function UsersAdminPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [memberTypeId, setMemberTypeId] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [myRole, setMyRole] = useState<string>("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberTypes, setMemberTypes] = useState<MemberType[]>([]);
  const [usageCaptureSubmodules, setUsageCaptureSubmodules] = useState<UsageCaptureSubmodule[]>([]);

  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeModules, setNewTypeModules] = useState<string[]>(["analytics_dashboard", "operations_dashboard", "forecast", "alerts", "reports_usage"]);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editTypeName, setEditTypeName] = useState("");
  const [editTypeModules, setEditTypeModules] = useState<string[]>([]);

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canManageTypes = myRole === "owner";

  const activeMemberTypes = useMemo(
    () => memberTypes.filter((t) => t.is_active).sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
    [memberTypes]
  );

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;

    if (!token) {
      router.replace("/login");
      return null;
    }
    return token;
  }

  async function bootstrap() {
    setLoading(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

    await Promise.all([loadRole(token), loadMembers(token), loadMemberTypes(token)]);
    setLoading(false);
  }

  async function loadRole(token: string) {
    const res = await fetch("/api/orgs/branding", { headers: { Authorization: `Bearer ${token}` } });
    const json = await res.json().catch(() => ({}));
    if (res.ok) setMyRole(String(json.role ?? ""));
  }

  async function loadMembers(token?: string) {
    setError("");
    const t = token ?? (await getTokenOrRedirect());
    if (!t) return;

    const res = await fetch("/api/admin/members", {
      headers: { Authorization: `Bearer ${t}` },
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(json.error || "No se pudieron cargar miembros (¿eres admin/owner?)");
      setMembers([]);
      return;
    }

    setMembers(Array.isArray(json.members) ? json.members : []);
  }

  async function loadMemberTypes(token?: string) {
    setError("");
    const t = token ?? (await getTokenOrRedirect());
    if (!t) return;

    const res = await fetch("/api/admin/member-types", {
      headers: { Authorization: `Bearer ${t}` },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((prev) => prev || json.error || "No se pudieron cargar tipos de miembro");
      setMemberTypes([]);
      return;
    }

    const list = Array.isArray(json.member_types) ? (json.member_types as MemberType[]) : [];
    setMemberTypes(list);
    setUsageCaptureSubmodules(
      Array.isArray(json.usage_capture_submodule_keys)
        ? (json.usage_capture_submodule_keys as UsageCaptureSubmodule[])
        : []
    );
    if (!memberTypeId && list.length > 0) {
      setMemberTypeId(String(list.find((x) => x.is_active)?.id ?? list[0].id));
    }
  }

  async function invite() {
    setBusy(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError("Email requerido");
      setBusy(false);
      return;
    }

    const selectedType = memberTypes.find((t) => t.id === memberTypeId) ?? null;
    const fallbackRole: Role = (["owner", "admin", "member", "viewer"].includes((selectedType?.name ?? "").toLowerCase())
      ? (selectedType?.name.toLowerCase() as Role)
      : "member");

    const res = await fetch("/api/admin/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: cleanEmail, role: fallbackRole, member_type_id: memberTypeId || null }),
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
    await loadMembers(token);
  }

  async function removeAccess(userId: string, display: string) {
    const ok = confirm(`¿Quitar acceso a: ${display} ?`);
    if (!ok) return;

    setBusy(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

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
    await loadMembers(token);
  }

  function toggleNewTypeModule(moduleKey: string) {
    setNewTypeModules((prev) => {
      const removing = prev.includes(moduleKey);
      const next = removing ? prev.filter((m) => m !== moduleKey) : [...prev, moduleKey];
      if (moduleKey === "usage_capture" && removing) {
        return next.filter((m) => !m.startsWith(USAGE_CAPTURE_SUBMODULE_PREFIX));
      }
      return next;
    });
  }

  function startEditMemberType(t: MemberType) {
    if (t.is_system) return;
    setEditingTypeId(t.id);
    setEditTypeName(t.name);
    setEditTypeModules(t.modules.filter((m) => m.can_view).map((m) => m.module_key));
  }

  function cancelEditMemberType() {
    setEditingTypeId(null);
    setEditTypeName("");
    setEditTypeModules([]);
  }

  function toggleEditTypeModule(moduleKey: string) {
    setEditTypeModules((prev) => {
      const removing = prev.includes(moduleKey);
      const next = removing ? prev.filter((m) => m !== moduleKey) : [...prev, moduleKey];
      if (moduleKey === "usage_capture" && removing) {
        return next.filter((m) => !m.startsWith(USAGE_CAPTURE_SUBMODULE_PREFIX));
      }
      return next;
    });
  }

  async function createMemberType() {
    if (!canManageTypes) return;
    const name = newTypeName.trim();
    if (!name) {
      setError("Nombre de tipo requerido");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/admin/member-types", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, modules: newTypeModules }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudo crear tipo de miembro");
      setBusy(false);
      return;
    }

    setNewTypeName("");
    setMessage("Tipo de miembro creado.");
    await loadMemberTypes(token);
    setBusy(false);
  }

  async function deleteMemberType(id: string) {
    if (!canManageTypes) return;
    const ok = confirm("¿Eliminar este tipo de miembro personalizado?");
    if (!ok) return;

    setBusy(true);
    setError("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/admin/member-types?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudo eliminar tipo");
      setBusy(false);
      return;
    }

    setMessage("Tipo eliminado.");
    await loadMemberTypes(token);
    setBusy(false);
  }

  async function saveMemberTypeEdits(id: string) {
    if (!canManageTypes) return;
    const name = editTypeName.trim();
    if (!name) {
      setError("Nombre de tipo requerido");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch(`/api/admin/member-types?id=${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, modules: editTypeModules }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudo editar tipo");
      setBusy(false);
      return;
    }

    setMessage("Tipo actualizado.");
    cancelEditMemberType();
    await loadMemberTypes(token);
    setBusy(false);
  }

  if (loading) {
    return (
      <main style={{ minHeight: "60vh", padding: 16, maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Loader label="Cargando usuarios..." />
      </main>
    );
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
            <label>Tipo de miembro</label>
            <select
              value={memberTypeId}
              onChange={(e) => setMemberTypeId(e.target.value)}
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            >
              {activeMemberTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <button onClick={invite} disabled={busy} style={{ padding: 12, width: "100%" }}>
            {busy ? "Invitando..." : "Invitar"}
          </button>
        </div>
      </section>

      {canManageTypes ? (
        <section style={{ marginTop: 16, border: "1px solid #eee", padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>Tipos de miembro (owner)</h3>

          <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
            <input
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="Ej: Operador, Auditor"
              style={{ width: "100%", padding: 10 }}
              disabled={busy}
            />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
              {MODULE_KEYS.map((m) => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={newTypeModules.includes(m)}
                    onChange={() => toggleNewTypeModule(m)}
                    disabled={busy}
                  />
                  {m}
                </label>
              ))}
            </div>
            {newTypeModules.includes("usage_capture") && usageCaptureSubmodules.length > 0 ? (
              <div style={{ display: "grid", gap: 6, padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.8 }}>Submódulos captura enfocada (tipos de entidad)</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                  {usageCaptureSubmodules.map((s) => (
                    <label key={s.module_key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={newTypeModules.includes(s.module_key)}
                        onChange={() => toggleNewTypeModule(s.module_key)}
                        disabled={busy}
                      />
                      {s.entity_type_name}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <button onClick={createMemberType} disabled={busy} style={{ padding: 10, width: 220 }}>
              Crear tipo
            </button>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tipo</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Módulos visibles</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Acción</th>
                </tr>
              </thead>
              <tbody>
                {memberTypes.map((t) => (
                  <tr key={t.id}>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                      {editingTypeId === t.id ? (
                        <input
                          value={editTypeName}
                          onChange={(e) => setEditTypeName(e.target.value)}
                          style={{ width: "100%", padding: 8 }}
                          disabled={busy}
                        />
                      ) : (
                        <>
                          {t.name} {t.is_system ? "(sistema)" : ""} {t.is_active ? "" : "[inactivo]"}
                        </>
                      )}
                    </td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8, fontSize: 12 }}>
                      {editingTypeId === t.id ? (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                            {MODULE_KEYS.map((m) => (
                              <label key={m} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <input
                                  type="checkbox"
                                  checked={editTypeModules.includes(m)}
                                  onChange={() => toggleEditTypeModule(m)}
                                  disabled={busy}
                                />
                                {m}
                              </label>
                            ))}
                          </div>
                          {editTypeModules.includes("usage_capture") && usageCaptureSubmodules.length > 0 ? (
                            <div style={{ display: "grid", gap: 6, marginTop: 8, padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>Submódulos captura enfocada (tipos de entidad)</div>
                              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                                {usageCaptureSubmodules.map((s) => (
                                  <label key={s.module_key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <input
                                      type="checkbox"
                                      checked={editTypeModules.includes(s.module_key)}
                                      onChange={() => toggleEditTypeModule(s.module_key)}
                                      disabled={busy}
                                    />
                                    {s.entity_type_name}
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        t.modules.filter((m) => m.can_view).map((m) => m.module_key).join(", ") || "—"
                      )}
                    </td>
                    <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>
                      {!t.is_system ? (
                        editingTypeId === t.id ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={() => void saveMemberTypeEdits(t.id)} disabled={busy} style={{ padding: 8 }}>
                              Guardar
                            </button>
                            <button onClick={cancelEditMemberType} disabled={busy} style={{ padding: 8 }}>
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button onClick={() => startEditMemberType(t)} disabled={busy} style={{ padding: 8 }}>
                              Editar
                            </button>
                            <button onClick={() => void deleteMemberType(t.id)} disabled={busy} style={{ padding: 8 }}>
                              Eliminar
                            </button>
                          </div>
                        )
                      ) : (
                        <span style={{ opacity: 0.6, fontSize: 12 }}>Protegido</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section style={{ marginTop: 16, border: "1px solid #eee", padding: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h3 style={{ marginTop: 0 }}>Miembros</h3>
          <button onClick={() => void loadMembers()} disabled={busy || loading} style={{ padding: 10 }}>
            Refrescar
          </button>
        </div>

        {members.length === 0 ? (
          <p style={{ opacity: 0.75 }}>No hay miembros para mostrar (o no tienes permisos admin/owner).</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Email</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Rol base</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Tipo miembro</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Creado</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8 }}>Acciones</th>
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
                      <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{m.member_type_name || "—"}</td>
                      <td style={{ borderBottom: "1px solid #f3f3f3", padding: 8 }}>{new Date(m.created_at).toLocaleString()}</td>
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
