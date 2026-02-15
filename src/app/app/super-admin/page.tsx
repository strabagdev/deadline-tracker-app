"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";

type StatusResponse = {
  has_super_admin?: boolean;
  is_super_admin?: boolean;
  email?: string | null;
  error?: string;
};

type OrganizationSummary = {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  owners: Array<{ user_id: string; email: string | null }>;
};

export default function SuperAdminPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const [organizationName, setOrganizationName] = useState("");
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [ownerDrafts, setOwnerDrafts] = useState<Record<string, string>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [platformLogoUrl, setPlatformLogoUrl] = useState("");
  const [platformLogoFile, setPlatformLogoFile] = useState<File | null>(null);
  const [brandingBusy, setBrandingBusy] = useState(false);

  useEffect(() => {
    void validateAccess();
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

  async function validateAccess() {
    setLoading(true);
    setError("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/super-admin/status", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = (await res.json().catch(() => ({}))) as StatusResponse;
    if (!res.ok) {
      setError(json.error || "No se pudo validar permisos.");
      setLoading(false);
      return;
    }

    if (!json.is_super_admin) {
      router.replace("/app");
      return;
    }

    await loadOrganizations(token);
    await loadPlatformBranding(token);
    setLoading(false);
  }

  async function loadPlatformBranding(providedToken?: string) {
    const token = providedToken ?? (await getTokenOrRedirect());
    if (!token) return;

    const res = await fetch("/api/platform/branding", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      platform?: { logo_url?: string | null };
    };

    if (!res.ok) return;

    setPlatformLogoUrl(json.platform?.logo_url || "");
  }

  async function loadOrganizations(providedToken?: string) {
    const token = providedToken ?? (await getTokenOrRedirect());
    if (!token) return;

    const res = await fetch("/api/platform/admin/orgs", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      organizations?: OrganizationSummary[];
    };

    if (!res.ok) {
      setError(json.error || "No se pudieron cargar organizaciones.");
      return;
    }

    setOrganizations(Array.isArray(json.organizations) ? json.organizations : []);
    if (!inviteOrgId && Array.isArray(json.organizations) && json.organizations[0]?.id) {
      setInviteOrgId(String(json.organizations[0].id));
    }
  }

  async function createOrganization() {
    setBusy(true);
    setError("");
    setOk("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/admin/orgs/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        organizationName: organizationName.trim(),
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      organization?: { id: string; name: string };
    };

    if (!res.ok) {
      setError(json.error || "No se pudo crear organización.");
      setBusy(false);
      return;
    }

    setOk(
      `Organización creada: ${json.organization?.name || "(sin nombre)"}.\nAhora asigna el primer owner usando "Invitación global" con rol owner.`
    );
    setOrganizationName("");
    await loadOrganizations(token);
    setBusy(false);
  }

  async function deleteOrganization(organizationId: string, organizationName: string) {
    const okConfirm = window.confirm(
      `¿Eliminar organización "${organizationName}"? Esta acción borrará datos asociados de esa organización.`
    );
    if (!okConfirm) return;

    setBusy(true);
    setError("");
    setOk("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/admin/orgs/delete", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationId }),
    });

    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error || "No se pudo eliminar la organización.");
      setBusy(false);
      return;
    }

    setOk(`Organización eliminada: ${organizationName}`);
    if (inviteOrgId === organizationId) setInviteOrgId("");
    await loadOrganizations(token);
    setBusy(false);
  }

  async function assignOwner(organizationId: string) {
    setBusy(true);
    setError("");
    setOk("");

    const ownerDraft = (ownerDrafts[organizationId] ?? "").trim().toLowerCase();
    if (!ownerDraft) {
      setError("Debes ingresar un email para asignar owner.");
      setBusy(false);
      return;
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/admin/orgs", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        organizationId,
        ownerEmail: ownerDraft,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      organization?: { id: string; name: string };
      owner?: { user_id: string; email: string };
    };

    if (!res.ok) {
      setError(json.error || "No se pudo asignar owner.");
      setBusy(false);
      return;
    }

    setOk(
      `Owner asignado en ${json.organization?.name || organizationId}: ${json.owner?.email || ownerDraft}.`
    );
    setOwnerDrafts((prev) => ({ ...prev, [organizationId]: "" }));
    await loadOrganizations(token);
    setBusy(false);
  }

  async function removeOwner(organizationId: string, ownerUserId: string, ownerEmail: string | null) {
    const label = ownerEmail || ownerUserId;
    const okConfirm = window.confirm(
      `¿Eliminar owner ${label} de esta organización? Debe quedar al menos un owner activo.`
    );
    if (!okConfirm) return;

    setBusy(true);
    setError("");
    setOk("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/admin/orgs", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        organizationId,
        ownerUserId,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error || "No se pudo eliminar owner.");
      setBusy(false);
      return;
    }

    setOk(`Owner eliminado: ${label}`);
    await loadOrganizations(token);
    setBusy(false);
  }

  async function sendGlobalInvite() {
    setBusy(true);
    setError("");
    setOk("");

    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      setError("Debes ingresar un email para invitar.");
      setBusy(false);
      return;
    }
    if (!inviteOrgId) {
      setError("Debes seleccionar una organización destino.");
      setBusy(false);
      return;
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/admin/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email,
        organizationId: inviteOrgId,
        role: inviteRole,
      }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      organization?: { id: string; name: string };
      invited?: { user_id: string; email: string; role: string };
    };

    if (!res.ok) {
      setError(json.error || "No se pudo enviar invitación.");
      setBusy(false);
      return;
    }

    setOk(
      `Invitación enviada/asignada: ${json.invited?.email || email} → ${json.organization?.name || inviteOrgId} (${json.invited?.role || inviteRole}).`
    );
    setInviteEmail("");
    await loadOrganizations(token);
    setBusy(false);
  }

  async function updatePlatformLogo() {
    setBrandingBusy(true);
    setError("");
    setOk("");

    if (!platformLogoFile) {
      setError("Debes seleccionar un archivo de logo.");
      setBrandingBusy(false);
      return;
    }

    const token = await getTokenOrRedirect();
    if (!token) return;

    const form = new FormData();
    form.append("file", platformLogoFile);

    const res = await fetch("/api/platform/branding", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      platform?: { logo_url?: string | null };
    };

    if (!res.ok) {
      setError(json.error || "No se pudo actualizar el logo de plataforma.");
      setBrandingBusy(false);
      return;
    }

    setPlatformLogoUrl(json.platform?.logo_url || "");
    setPlatformLogoFile(null);
    setOk("Logo de plataforma actualizado.");
    setBrandingBusy(false);
  }

  async function removePlatformLogo() {
    setBrandingBusy(true);
    setError("");
    setOk("");

    const token = await getTokenOrRedirect();
    if (!token) return;

    const res = await fetch("/api/platform/branding", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      platform?: { logo_url?: string | null };
    };

    if (!res.ok) {
      setError(json.error || "No se pudo eliminar el logo de plataforma.");
      setBrandingBusy(false);
      return;
    }

    setPlatformLogoUrl(json.platform?.logo_url || "");
    setPlatformLogoFile(null);
    setOk("Logo de plataforma eliminado.");
    setBrandingBusy(false);
  }

  if (loading) return <p style={{ padding: 16 }}>Validando permisos...</p>;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
      <h2>Super Admin</h2>
      <p style={{ opacity: 0.8 }}>
        Menu exclusivo para administracion global de plataforma.
      </p>

      {error && <p style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{error}</p>}
      {ok && <p style={{ color: "green", whiteSpace: "pre-wrap" }}>{ok}</p>}

      <section style={{ marginTop: 14, border: "1px solid #eee", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Branding de plataforma</h3>
        <p style={{ fontSize: 12, opacity: 0.75 }}>
          Este logo es global y se muestra en el header para todos los usuarios.
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          {platformLogoUrl ? (
            <img
              src={platformLogoUrl}
              alt="Logo plataforma"
              width={96}
              height={96}
              style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 12, border: "1px solid #e5e5e5" }}
            />
          ) : (
            <div style={{ fontSize: 12, opacity: 0.75 }}>No hay logo global configurado.</div>
          )}

          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => setPlatformLogoFile(e.target.files?.[0] ?? null)}
            disabled={brandingBusy}
          />

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={updatePlatformLogo} disabled={brandingBusy || !platformLogoFile} style={{ padding: "10px 12px" }}>
              {brandingBusy ? "Guardando..." : "Guardar logo plataforma"}
            </button>
            <button onClick={removePlatformLogo} disabled={brandingBusy || !platformLogoUrl} style={{ padding: "10px 12px" }}>
              {brandingBusy ? "Eliminando..." : "Eliminar logo plataforma"}
            </button>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 14, border: "1px solid #eee", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Crear organización</h3>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label>Nombre de organizacion</label>
            <input
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Acme Corp"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            />
          </div>

          <button onClick={createOrganization} disabled={busy} style={{ width: "100%", padding: 12 }}>
            {busy ? "Creando..." : "Crear organización"}
          </button>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            El primer owner se asigna por invitación global (rol owner), no automáticamente.
          </div>
        </div>
      </section>

      <section style={{ marginTop: 14, border: "1px solid #eee", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Invitación global (Super Admin)</h3>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <label>Email a invitar</label>
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="usuario@empresa.com"
              type="email"
              style={{ width: "100%", padding: 10, marginTop: 6 }}
              disabled={busy}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", gap: 10 }}>
            <div>
              <label>Organización destino</label>
              <select
                value={inviteOrgId}
                onChange={(e) => setInviteOrgId(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                disabled={busy}
              >
                <option value="">Selecciona organización…</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>Rol</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                style={{ width: "100%", padding: 10, marginTop: 6 }}
                disabled={busy}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
                <option value="owner">owner</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
          </div>

          <button onClick={sendGlobalInvite} disabled={busy} style={{ width: "100%", padding: 12 }}>
            {busy ? "Enviando..." : "Invitar a organización"}
          </button>
        </div>
      </section>

      <section style={{ marginTop: 14, border: "1px solid #eee", padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Organizaciones y owners</h3>
        {organizations.length === 0 ? (
          <p style={{ opacity: 0.75 }}>Aún no hay organizaciones creadas.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {organizations.map((org) => (
              <div key={org.id} style={{ border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{org.name}</div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                      ID: {org.id} · Miembros: {org.member_count}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                      Owners:
                    </div>
                    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                      {org.owners.length === 0 ? (
                        <div style={{ fontSize: 12, opacity: 0.75 }}>Sin owner</div>
                      ) : (
                        org.owners.map((o) => (
                          <div
                            key={`${org.id}-${o.user_id}`}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 8,
                              border: "1px solid #f0f0f0",
                              borderRadius: 8,
                              padding: "6px 8px",
                            }}
                          >
                            <span style={{ fontSize: 12 }}>{o.email || o.user_id}</span>
                            <button
                              onClick={() => removeOwner(org.id, o.user_id, o.email)}
                              disabled={busy || org.owners.length <= 1}
                              style={{ padding: "6px 8px" }}
                              title={
                                org.owners.length <= 1
                                  ? "No se puede eliminar el último owner"
                                  : "Eliminar owner"
                              }
                            >
                              Eliminar
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 8, minWidth: 280 }}>
                    <input
                      value={ownerDrafts[org.id] ?? ""}
                      onChange={(e) =>
                        setOwnerDrafts((prev) => ({ ...prev, [org.id]: e.target.value }))
                      }
                      placeholder="nuevo-owner@empresa.com"
                      type="email"
                      style={{ width: "100%", padding: 10 }}
                      disabled={busy}
                    />
                    <button onClick={() => assignOwner(org.id)} disabled={busy} style={{ padding: "10px 12px" }}>
                      Asignar owner
                    </button>
                    <button
                      onClick={() => deleteOrganization(org.id, org.name)}
                      disabled={busy}
                      style={{ padding: "10px 12px" }}
                    >
                      Eliminar organización
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
