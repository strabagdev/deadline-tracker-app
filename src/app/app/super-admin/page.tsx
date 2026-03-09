"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [platformLogoPreviewUrl, setPlatformLogoPreviewUrl] = useState("");
  const [brandingBusy, setBrandingBusy] = useState(false);
  const platformLogoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void validateAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!platformLogoFile) {
      setPlatformLogoPreviewUrl("");
      return;
    }

    const objectUrl = URL.createObjectURL(platformLogoFile);
    setPlatformLogoPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [platformLogoFile]);

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
    try {
      const token = await getTokenOrRedirect();
      if (!token) return;

      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 10000);
      const res = await fetch("/api/platform/super-admin/status", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }).finally(() => window.clearTimeout(timeoutId));

      const json = (await res.json().catch(() => ({}))) as StatusResponse;
      if (!res.ok) {
        setError(json.error || "No se pudo validar permisos.");
        return;
      }

      if (!json.is_super_admin) {
        router.replace("/app");
        return;
      }

      await Promise.all([loadOrganizations(token), loadPlatformBranding(token)]);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        setError("Tiempo de espera agotado validando permisos de super admin.");
      } else {
        setError("Error validando permisos de super admin.");
      }
    } finally {
      setLoading(false);
    }
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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBusy(false);
      return;
    }

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
    if (!token) {
      setBrandingBusy(false);
      return;
    }

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
    setPlatformLogoPreviewUrl("");
    setOk("Logo de plataforma actualizado.");
    setBrandingBusy(false);
  }

  async function removePlatformLogo() {
    setBrandingBusy(true);
    setError("");
    setOk("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setBrandingBusy(false);
      return;
    }

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
    setPlatformLogoPreviewUrl("");
    setOk("Logo de plataforma eliminado.");
    setBrandingBusy(false);
  }

  if (loading) {
    return (
      <div style={{ padding: 16, display: "flex", justifyContent: "center" }}>
        <Loader label="Validando permisos..." />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-4">
      <h2 className="text-2xl font-semibold">Super Admin</h2>
      <p className="mt-1 text-sm text-slate-600">
        Menú exclusivo para administración global de plataforma.
      </p>

      {error ? <p className="mt-3 whitespace-pre-wrap text-sm text-rose-600">{error}</p> : null}
      {ok ? <p className="mt-3 whitespace-pre-wrap text-sm text-emerald-600">{ok}</p> : null}

      <section style={{ marginTop: 14 }}>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Branding de plataforma</CardTitle>
              <Badge variant="secondary">Global</Badge>
            </div>
            <CardDescription>
              Configura el logo maestro visible en el header de toda la plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[150px_1fr] md:items-start">
              <div className="rounded-xl border bg-slate-50 p-3">
                {platformLogoPreviewUrl || platformLogoUrl ? (
                  <Image
                    src={platformLogoPreviewUrl || platformLogoUrl}
                    alt="Logo plataforma"
                    width={120}
                    height={120}
                    className="h-[120px] w-[120px] rounded-lg border object-cover"
                  />
                ) : (
                  <div className="flex h-[120px] w-[120px] items-center justify-center rounded-lg border bg-white text-xs text-slate-500">
                    Sin logo
                  </div>
                )}
              </div>

              <div className="grid gap-3">
                <input
                  ref={platformLogoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => setPlatformLogoFile(e.target.files?.[0] ?? null)}
                  disabled={brandingBusy}
                  style={{ display: "none" }}
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => platformLogoInputRef.current?.click()}
                    disabled={brandingBusy}
                    variant="outline"
                  >
                    Seleccionar archivo
                  </Button>
                  <Button onClick={updatePlatformLogo} disabled={brandingBusy || !platformLogoFile}>
                    {brandingBusy ? "Guardando..." : "Guardar logo"}
                  </Button>
                  <Button
                    onClick={removePlatformLogo}
                    disabled={brandingBusy || !platformLogoUrl}
                    variant="destructive"
                  >
                    {brandingBusy ? "Eliminando..." : "Eliminar logo"}
                  </Button>
                </div>

                <div className="text-xs text-slate-600">
                  {platformLogoFile ? `Archivo seleccionado: ${platformLogoFile.name}` : "Sin archivo seleccionado"}
                </div>
                <div className="text-xs text-slate-500">
                  Formatos permitidos: PNG, JPG, WEBP, SVG. Tamaño máximo: 4MB.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Crear organización</CardTitle>
            <CardDescription>
              Crea una organización nueva. El primer owner se asigna después por invitación global.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="organization_name">Nombre de organización</Label>
              <Input
                id="organization_name"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="Acme Corp"
                disabled={busy}
              />
            </div>
            <Button onClick={createOrganization} disabled={busy} className="w-full">
              {busy ? "Creando..." : "Crear organización"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitación global</CardTitle>
            <CardDescription>
              Invita un usuario y define organización destino y rol desde el panel global.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="invite_email">Email a invitar</Label>
              <Input
                id="invite_email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="usuario@empresa.com"
                type="email"
                disabled={busy}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_170px]">
              <div className="grid gap-2">
                <Label htmlFor="invite_org">Organización destino</Label>
                <select
                  id="invite_org"
                  value={inviteOrgId}
                  onChange={(e) => setInviteOrgId(e.target.value)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
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

              <div className="grid gap-2">
                <Label htmlFor="invite_role">Rol</Label>
                <select
                  id="invite_role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm"
                  disabled={busy}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                  <option value="owner">owner</option>
                  <option value="viewer">viewer</option>
                </select>
              </div>
            </div>

            <Button onClick={sendGlobalInvite} disabled={busy} className="w-full">
              {busy ? "Enviando..." : "Invitar a organización"}
            </Button>
          </CardContent>
        </Card>
      </section>

      <section className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Organizaciones y owners</CardTitle>
            <CardDescription>
              Administra owners por organización y elimina organizaciones cuando sea necesario.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {organizations.length === 0 ? (
              <p className="text-sm text-slate-600">Aún no hay organizaciones creadas.</p>
            ) : (
              <div className="grid gap-3">
                {organizations.map((org) => (
                  <div key={org.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-semibold text-slate-900">{org.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          ID: {org.id} · Miembros: {org.member_count}
                        </div>
                        <div className="mt-3 text-xs font-medium text-slate-600">Owners</div>

                        <div className="mt-2 grid gap-2">
                          {org.owners.length === 0 ? (
                            <div className="text-xs text-slate-500">Sin owner</div>
                          ) : (
                            org.owners.map((o) => (
                              <div
                                key={`${org.id}-${o.user_id}`}
                                className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                              >
                                <span className="truncate text-xs text-slate-700">{o.email || o.user_id}</span>
                                <Button
                                  onClick={() => removeOwner(org.id, o.user_id, o.email)}
                                  disabled={busy || org.owners.length <= 1}
                                  variant="outline"
                                  size="sm"
                                  title={
                                    org.owners.length <= 1
                                      ? "No se puede eliminar el último owner"
                                      : "Eliminar owner"
                                  }
                                >
                                  Eliminar
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="grid min-w-[280px] gap-2">
                        <Input
                          value={ownerDrafts[org.id] ?? ""}
                          onChange={(e) => setOwnerDrafts((prev) => ({ ...prev, [org.id]: e.target.value }))}
                          placeholder="nuevo-owner@empresa.com"
                          type="email"
                          disabled={busy}
                        />
                        <Button onClick={() => assignOwner(org.id)} disabled={busy}>
                          Asignar owner
                        </Button>
                        <Button onClick={() => deleteOrganization(org.id, org.name)} disabled={busy} variant="destructive">
                          Eliminar organización
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
