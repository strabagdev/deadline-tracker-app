"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  base_role: Role;
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

const MODULE_LABELS: Record<(typeof MODULE_KEYS)[number], string> = {
  analytics_dashboard: "Dashboard analítico",
  operations_dashboard: "Dashboard operativo",
  forecast: "Pronóstico",
  alerts: "Eventos",
  entities: "Entidades",
  reports_usage: "Reportes de uso",
  semaphore: "Semáforo",
  entity_types: "Tipos de entidad",
  deadline_types: "Tipos de vencimiento",
  usage_units: "Unidades de uso",
  usage_capture: "Registro de uso",
  bi_integrations: "Integraciones BI",
  users: "Usuarios",
};

function summarizeMemberType(type: MemberType | null, usageCaptureSubmodules: UsageCaptureSubmodule[]) {
  if (!type) return null;

  const visibleModules = type.modules.filter((m) => m.can_view).map((m) => m.module_key);
  const baseModules = visibleModules.filter((moduleKey) => !moduleKey.startsWith(USAGE_CAPTURE_SUBMODULE_PREFIX));
  const usageSubmodules = usageCaptureSubmodules
    .filter((submodule) => visibleModules.includes(submodule.module_key))
    .map((submodule) => submodule.entity_type_name);

  return {
    baseRole: type.base_role,
    baseModules: baseModules.map((moduleKey) =>
      moduleKey in MODULE_LABELS ? MODULE_LABELS[moduleKey as keyof typeof MODULE_LABELS] : moduleKey
    ),
    usageSubmodules,
  };
}

export default function UsersAdminPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email]);
  const [inviteRole, setInviteRole] = useState<Role>("member");
  const [memberTypeId, setMemberTypeId] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inviteCooldownUntil, setInviteCooldownUntil] = useState<number>(0);
  const [nowTs, setNowTs] = useState(() => Date.now());

  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");

  const [myRole, setMyRole] = useState<string>("");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [memberTypes, setMemberTypes] = useState<MemberType[]>([]);
  const [usageCaptureSubmodules, setUsageCaptureSubmodules] = useState<UsageCaptureSubmodule[]>([]);

  const [newTypeName, setNewTypeName] = useState("");
  const [newTypeBaseRole, setNewTypeBaseRole] = useState<Role>("member");
  const [newTypeModules, setNewTypeModules] = useState<string[]>(["analytics_dashboard", "operations_dashboard", "forecast", "alerts", "reports_usage"]);
  const [showCreateTypeForm, setShowCreateTypeForm] = useState(false);
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [editTypeName, setEditTypeName] = useState("");
  const [editTypeBaseRole, setEditTypeBaseRole] = useState<Role>("member");
  const [editTypeModules, setEditTypeModules] = useState<string[]>([]);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberRole, setEditMemberRole] = useState<Role>("member");
  const [editMemberTypeId, setEditMemberTypeId] = useState<string>("");

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canManageTypes = myRole === "owner";

  const activeMemberTypes = useMemo(
    () => memberTypes.filter((t) => t.is_active).sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
    [memberTypes]
  );
  const inviteCompatibleMemberTypes = useMemo(
    () => activeMemberTypes.filter((t) => t.base_role === inviteRole),
    [activeMemberTypes, inviteRole]
  );
  const editCompatibleMemberTypes = useMemo(
    () => activeMemberTypes.filter((t) => t.base_role === editMemberRole),
    [activeMemberTypes, editMemberRole]
  );
  const selectedInviteMemberType = useMemo(
    () => inviteCompatibleMemberTypes.find((t) => t.id === memberTypeId) ?? null,
    [inviteCompatibleMemberTypes, memberTypeId]
  );
  const selectedEditMemberType = useMemo(
    () => editCompatibleMemberTypes.find((t) => t.id === editMemberTypeId) ?? null,
    [editCompatibleMemberTypes, editMemberTypeId]
  );

  const inviteMemberTypeSummary = useMemo(
    () => summarizeMemberType(selectedInviteMemberType, usageCaptureSubmodules),
    [selectedInviteMemberType, usageCaptureSubmodules]
  );
  const editMemberTypeSummary = useMemo(
    () => summarizeMemberType(selectedEditMemberType, usageCaptureSubmodules),
    [selectedEditMemberType, usageCaptureSubmodules]
  );
  const canInviteEmail = nowTs >= inviteCooldownUntil;
  const activeTemplateCount = useMemo(() => memberTypes.filter((type) => type.is_active).length, [memberTypes]);
  const ownerCount = useMemo(() => members.filter((member) => member.role === "owner").length, [members]);

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

  useEffect(() => {
    if (memberTypeId && !inviteCompatibleMemberTypes.some((t) => t.id === memberTypeId)) {
      setMemberTypeId("");
    }
  }, [inviteCompatibleMemberTypes, memberTypeId]);

  useEffect(() => {
    if (editMemberTypeId && !editCompatibleMemberTypes.some((t) => t.id === editMemberTypeId)) {
      setEditMemberTypeId("");
    }
  }, [editCompatibleMemberTypes, editMemberTypeId]);

  useEffect(() => {
    if (inviteCooldownUntil <= nowTs) return;
    const id = window.setInterval(() => setNowTs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [inviteCooldownUntil, nowTs]);

  async function invite() {
    setBusy(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    if (!normalizedEmail) {
      setError("Email requerido");
      setBusy(false);
      return;
    }

    if (!canInviteEmail) {
      const seconds = Math.max(1, Math.ceil((inviteCooldownUntil - Date.now()) / 1000));
      setError(`Espera ${seconds}s antes de reenviar la invitación a ${normalizedEmail}.`);
      setBusy(false);
      return;
    }

    const res = await fetch("/api/admin/invite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: normalizedEmail, role: inviteRole, member_type_id: memberTypeId || null }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (json.code === "INVITE_EMAIL_COOLDOWN") {
        const cooldownUntil = new Date(String(json.cooldown_until ?? "")).getTime();
        if (Number.isFinite(cooldownUntil)) {
          setInviteCooldownUntil(cooldownUntil);
          setNowTs(Date.now());
        }
      }
      setError(json.error || "No se pudo invitar");
      setBusy(false);
      return;
    }

    setInviteCooldownUntil(0);
    setMessage(
      json.delivery === "existing_user_linked"
        ? "Usuario existente vinculado a la organización. No se envió correo de invitación."
        : "Invitación enviada por correo y acceso asignado."
    );
    setEmail("");
    setBusy(false);
    await loadMembers(token);
  }

  function startEditMember(member: MemberRow) {
    setEditingMemberId(member.user_id);
    setEditMemberRole(member.role);
    setEditMemberTypeId(String(member.member_type_id ?? ""));
  }

  function cancelEditMember() {
    setEditingMemberId(null);
    setEditMemberRole("member");
    setEditMemberTypeId("");
  }

  async function saveMemberAccess(userId: string) {
    setBusy(true);
    setError("");
    setMessage("");

    const token = await getTokenOrRedirect();
    if (!token) {
      setBusy(false);
      return;
    }

    const res = await fetch("/api/admin/members", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_id: userId,
        role: editMemberRole,
        member_type_id: editMemberTypeId || null,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudieron actualizar los permisos del miembro");
      setBusy(false);
      return;
    }

    setMessage("Permisos del miembro actualizados.");
    cancelEditMember();
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
    setEditTypeBaseRole(t.base_role);
    setEditTypeModules(t.modules.filter((m) => m.can_view).map((m) => m.module_key));
  }

  function cancelEditMemberType() {
    setEditingTypeId(null);
    setEditTypeName("");
    setEditTypeBaseRole("member");
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
      body: JSON.stringify({ name, base_role: newTypeBaseRole, modules: newTypeModules }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || "No se pudo crear tipo de miembro");
      setBusy(false);
      return;
    }

    setNewTypeName("");
    setNewTypeBaseRole("member");
    setShowCreateTypeForm(false);
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
      body: JSON.stringify({ name, base_role: editTypeBaseRole, modules: editTypeModules }),
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
      <main className="mx-auto flex min-h-[60vh] max-w-[1400px] items-center justify-center px-4 py-4">
        <Loader label="Cargando usuarios..." />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
      <section className="rounded-[26px] border border-[rgba(17,32,28,0.08)] bg-[linear-gradient(180deg,rgba(251,253,252,0.98),rgba(245,249,248,0.96))] p-4 shadow-[0_20px_60px_-44px_rgba(15,23,42,0.3)]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-slate-900 text-white hover:bg-slate-900">Configuración</Badge>
              <Badge variant="secondary" className="bg-amber-50 text-amber-700 hover:bg-amber-50">
                Usuarios
              </Badge>
            </div>
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
              Accesos, invitaciones y plantillas
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Administra miembros de la organización, roles base y plantillas de permisos reutilizables.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Miembros</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{members.length}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Plantillas</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{memberTypes.length}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Activas</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{activeTemplateCount}</div>
              </CardContent>
            </Card>
            <Card className="border-slate-200/80 bg-white shadow-none">
              <CardContent className="px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Owners</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{ownerCount}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 whitespace-pre-wrap">{error}</div> : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 whitespace-pre-wrap">{message}</div> : null}

      <section className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Invitación</div>
              <CardTitle className="text-base sm:text-lg">Invitar usuario</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-slate-500">
                La invitación define el acceso base. Los permisos finos se pueden ajustar después por miembro.
              </p>

              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Email</label>
                <Input
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                  placeholder="persona@empresa.com"
                  type="email"
                  disabled={busy}
                />
                {!canInviteEmail && normalizedEmail ? (
                  <div className="text-xs text-amber-700">
                    Supabase enfrió este correo. Reintenta en {Math.max(1, Math.ceil((inviteCooldownUntil - nowTs) / 1000))}s.
                  </div>
                ) : null}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Rol base</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                    disabled={busy}
                  >
                    <option value="viewer">viewer</option>
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    {canManageTypes ? <option value="owner">owner</option> : null}
                  </select>
                </div>

                <div className="grid gap-2">
                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Plantilla</label>
                  <select
                    value={memberTypeId}
                    onChange={(e) => setMemberTypeId(e.target.value)}
                    className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                    disabled={busy}
                  >
                    <option value="">Sin plantilla</option>
                    {inviteCompatibleMemberTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {inviteMemberTypeSummary ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
                  <div className="font-medium text-slate-800">
                    Plantilla activa: {selectedInviteMemberType?.name} · rol base {inviteMemberTypeSummary.baseRole}
                  </div>
                  <div className="mt-1 text-slate-500">
                    Módulos: {inviteMemberTypeSummary.baseModules.join(", ") || "Sin módulos visibles"}
                  </div>
                  {inviteMemberTypeSummary.usageSubmodules.length > 0 ? (
                    <div className="mt-1 text-slate-500">
                      Captura enfocada: {inviteMemberTypeSummary.usageSubmodules.join(", ")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <Button onClick={invite} disabled={busy || !canInviteEmail} className="w-full">
                {busy ? "Invitando..." : !canInviteEmail ? `Espera ${Math.max(1, Math.ceil((inviteCooldownUntil - nowTs) / 1000))}s` : "Invitar"}
              </Button>
            </CardContent>
          </Card>

          {canManageTypes ? (
            <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Plantillas</div>
                    <CardTitle className="text-base sm:text-lg">Tipos de miembro</CardTitle>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowCreateTypeForm((v) => !v)} disabled={busy}>
                    {showCreateTypeForm ? "Ocultar" : "Nueva plantilla"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {showCreateTypeForm ? (
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <Input
                      value={newTypeName}
                      onChange={(e) => setNewTypeName(e.target.value)}
                      placeholder="Ej: Operador, Auditor"
                      disabled={busy}
                    />
                    <div className="grid gap-2">
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Rol base</label>
                      <select
                        value={newTypeBaseRole}
                        onChange={(e) => setNewTypeBaseRole(e.target.value as Role)}
                        className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                        disabled={busy}
                      >
                        <option value="viewer">viewer</option>
                        <option value="member">member</option>
                        <option value="admin">admin</option>
                        <option value="owner">owner</option>
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Módulos visibles</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {MODULE_KEYS.map((m) => (
                          <label key={m} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
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
                    </div>
                    {newTypeModules.includes("usage_capture") && usageCaptureSubmodules.length > 0 ? (
                      <div className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                          Submódulos de captura
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          {usageCaptureSubmodules.map((s) => (
                            <label key={s.module_key} className="flex items-center gap-2 text-sm text-slate-700">
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
                    <div className="flex gap-2">
                      <Button onClick={createMemberType} disabled={busy}>Crear tipo</Button>
                      <Button variant="outline" onClick={() => setShowCreateTypeForm(false)} disabled={busy}>Cancelar</Button>
                    </div>
                  </div>
                ) : null}
                <p className="text-sm text-slate-500">
                  Las plantillas permiten reutilizar combinaciones de módulos y restringir capturas por tipo de entidad.
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {canManageTypes ? (
            <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
              <CardHeader className="pb-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Plantillas existentes</div>
                <CardTitle className="text-base sm:text-lg">Catálogo de tipos de miembro</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {memberTypes.map((t) => (
                  <div key={t.id} className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.45)]">
                    {editingTypeId === t.id ? (
                      <div className="space-y-4">
                        <Input
                          value={editTypeName}
                          onChange={(e) => setEditTypeName(e.target.value)}
                          disabled={busy}
                        />
                        <select
                          value={editTypeBaseRole}
                          onChange={(e) => setEditTypeBaseRole(e.target.value as Role)}
                          className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                          disabled={busy}
                        >
                          <option value="viewer">viewer</option>
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                          <option value="owner">owner</option>
                        </select>
                        <div className="grid gap-2 md:grid-cols-2">
                          {MODULE_KEYS.map((m) => (
                            <label key={m} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
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
                          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Submódulos de captura</div>
                            <div className="grid gap-2 md:grid-cols-2">
                              {usageCaptureSubmodules.map((s) => (
                                <label key={s.module_key} className="flex items-center gap-2 text-sm text-slate-700">
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
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" onClick={() => void saveMemberTypeEdits(t.id)} disabled={busy}>Guardar</Button>
                          <Button variant="outline" size="sm" onClick={cancelEditMemberType} disabled={busy}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-base font-semibold text-slate-900">{t.name}</div>
                            <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100">{t.base_role}</Badge>
                            {t.is_system ? <Badge variant="secondary" className="bg-sky-50 text-sky-700 hover:bg-sky-50">Sistema</Badge> : null}
                            {!t.is_active ? <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-100">Inactivo</Badge> : null}
                          </div>
                          <div className="text-sm text-slate-500">
                            {t.modules.filter((m) => m.can_view).map((m) => m.module_key).join(", ") || "Sin módulos visibles"}
                          </div>
                        </div>
                        {!t.is_system ? (
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => startEditMemberType(t)} disabled={busy}>Editar</Button>
                            <Button variant="outline" size="sm" onClick={() => void deleteMemberType(t.id)} disabled={busy}>Eliminar</Button>
                          </div>
                        ) : (
                          <div className="text-xs text-slate-500">Protegido por sistema</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-[rgba(17,32,28,0.08)] bg-[rgba(255,255,255,0.84)]">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Miembros</div>
                  <CardTitle className="text-base sm:text-lg">Accesos actuales</CardTitle>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadMembers()} disabled={busy || loading}>
                  Refrescar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {members.length === 0 ? (
                <p className="text-sm text-slate-500">No hay miembros para mostrar o no tienes permisos suficientes.</p>
              ) : (
                members.map((m) => {
                  const display = m.email || m.user_id;
                  const isOwner = m.role === "owner";
                  const isEditing = editingMemberId === m.user_id;

                  return (
                    <div key={m.user_id} className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 shadow-[0_16px_40px_-36px_rgba(15,23,42,0.45)]">
                      {!isEditing ? (
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-base font-semibold text-slate-900">{m.email || "(sin email)"}</div>
                              <Badge variant="secondary" className="bg-slate-100 text-slate-700 hover:bg-slate-100">{m.role}</Badge>
                              {m.member_type_name ? <Badge variant="secondary" className="bg-amber-50 text-amber-700 hover:bg-amber-50">{m.member_type_name}</Badge> : null}
                            </div>
                            <div className="text-xs text-slate-500">Creado el {new Date(m.created_at).toLocaleString()}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startEditMember(m)}
                              disabled={busy || (isOwner && myRole !== "owner")}
                              title={isOwner && myRole !== "owner" ? "Solo owner puede editar a otro owner" : "Editar permisos"}
                            >
                              Editar permisos
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => removeAccess(m.user_id, display)}
                              disabled={busy || isOwner}
                              title={isOwner ? "No se puede remover al owner" : "Quitar acceso"}
                            >
                              Quitar acceso
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="text-sm font-medium text-slate-900">{m.email || "(sin email)"}</div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <select
                              value={editMemberRole}
                              onChange={(e) => setEditMemberRole(e.target.value as Role)}
                              className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                              disabled={busy}
                            >
                              <option value="viewer">viewer</option>
                              <option value="member">member</option>
                              <option value="admin">admin</option>
                              {canManageTypes ? <option value="owner">owner</option> : null}
                            </select>
                            <select
                              value={editMemberTypeId}
                              onChange={(e) => setEditMemberTypeId(e.target.value)}
                              className="h-10 rounded-[var(--radius-md)] border border-[color:var(--input)] bg-white px-3 text-sm"
                              disabled={busy}
                            >
                              <option value="">Sin plantilla</option>
                              {editCompatibleMemberTypes.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          {editMemberTypeSummary ? (
                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                              <div className="font-medium text-slate-800">
                                {selectedEditMemberType?.name} · rol base {editMemberTypeSummary.baseRole}
                              </div>
                              <div className="mt-1">
                                Módulos: {editMemberTypeSummary.baseModules.join(", ") || "Sin módulos visibles"}
                              </div>
                              {editMemberTypeSummary.usageSubmodules.length > 0 ? (
                                <div className="mt-1">
                                  Captura enfocada: {editMemberTypeSummary.usageSubmodules.join(", ")}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => void saveMemberAccess(m.user_id)} disabled={busy}>Guardar</Button>
                            <Button variant="outline" size="sm" onClick={cancelEditMember} disabled={busy}>Cancelar</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
