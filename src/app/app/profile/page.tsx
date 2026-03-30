"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Loader } from "@/components/ui/loader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHero } from "@/components/PageHero";

export default function ProfilePage() {
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [orgLoading, setOrgLoading] = useState(true);
  const [orgRole, setOrgRole] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [sessionEmail, setSessionEmail] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState("");
  const [logoError, setLogoError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data } = await supabaseAuth.auth.getSession();
      const token = data.session?.access_token;
      if (!cancelled) setSessionEmail(data.session?.user?.email ?? "");
      if (!token) {
        if (!cancelled) setOrgLoading(false);
        return;
      }

      const res = await fetch("/api/orgs/branding", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => ({}));

      if (cancelled) return;
      setOrgRole(json?.role ?? null);
      setOrgName(json?.organization?.name ?? "");
      setLogoUrl(json?.organization?.logo_url ?? "");
      setOrgLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function getAuthToken() {
    const { data } = await supabaseAuth.auth.getSession();
    return data.session?.access_token ?? null;
  }

  async function updatePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMsg("");

    if (password.length < 8) {
      setError("La nueva contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("La confirmación de contraseña no coincide.");
      return;
    }

    setBusy(true);
    const { error: updateErr } = await supabaseAuth.auth.updateUser({ password });
    setBusy(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    setPassword("");
    setConfirmPassword("");
    setMsg("Contraseña actualizada correctamente.");
  }

  async function uploadLogo(e: React.FormEvent) {
    e.preventDefault();
    setLogoError("");
    setLogoMsg("");

    if (!logoFile) {
      setLogoError("Selecciona una imagen.");
      return;
    }

    const token = await getAuthToken();
    if (!token) {
      setLogoError("Sesión inválida.");
      return;
    }

    setLogoBusy(true);
    const form = new FormData();
    form.append("file", logoFile);

    const res = await fetch("/api/orgs/branding", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = await res.json().catch(() => ({}));
    setLogoBusy(false);

    if (!res.ok) {
      setLogoError(json?.error ?? "No se pudo subir el logo.");
      return;
    }

    setLogoUrl(json?.organization?.logo_url ?? "");
    setLogoFile(null);
    setLogoMsg("Logo actualizado.");
  }

  async function removeLogo() {
    setLogoError("");
    setLogoMsg("");

    const token = await getAuthToken();
    if (!token) {
      setLogoError("Sesión inválida.");
      return;
    }

    setLogoBusy(true);
    const res = await fetch("/api/orgs/branding", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));
    setLogoBusy(false);

    if (!res.ok) {
      setLogoError(json?.error ?? "No se pudo eliminar el logo.");
      return;
    }

    setLogoUrl("");
    setLogoFile(null);
    setLogoMsg("Logo eliminado.");
  }

  const isOwner = orgRole === "owner";

  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-4">
      <PageHero
        badge="Cuenta"
        secondaryBadge={orgRole || "Sin rol"}
        title="Perfil de usuario"
        subtitle="Configuración de acceso y marca de organización."
        density="compact"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => router.replace("/app")}>
            Volver
          </Button>
        }
        footer={
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Badge variant="outline">Email: {sessionEmail || "—"}</Badge>
            <Badge variant="outline">Organización: {orgName || "—"}</Badge>
            <Badge variant="outline">Rol: {orgRole || "—"}</Badge>
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Seguridad</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={updatePassword} className="grid gap-3 md:max-w-[640px]">
            <label className="grid gap-1.5 text-xs text-slate-600">
              Nueva contraseña
              <Input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                disabled={busy}
              />
            </label>

            <label className="grid gap-1.5 text-xs text-slate-600">
              Confirmar contraseña
              <Input
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                type="password"
                disabled={busy}
              />
            </label>

            {error ? <p className="whitespace-pre-wrap text-sm text-rose-600">{error}</p> : null}
            {msg ? <p className="whitespace-pre-wrap text-sm text-emerald-700">{msg}</p> : null}

            <Button type="submit" disabled={busy} className="w-fit">
              {busy ? "Guardando..." : "Actualizar contraseña"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Marca de organización</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {orgLoading ? (
            <div className="py-4">
              <Loader label="Cargando organización..." size="sm" />
            </div>
          ) : !isOwner ? (
            <p className="text-sm text-slate-600">Solo el owner puede subir o eliminar el logo de la organización.</p>
          ) : (
            <form onSubmit={uploadLogo} className="grid gap-3 md:max-w-[640px]">
              {logoUrl ? (
                <Image
                  src={logoUrl}
                  alt="Logo actual de la organización"
                  width={88}
                  height={88}
                  className="h-[88px] w-[88px] rounded-xl object-cover"
                />
              ) : (
                <div className="text-sm text-slate-500">No hay logo configurado.</div>
              )}

              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                disabled={logoBusy}
              />

              {logoError ? <p className="whitespace-pre-wrap text-sm text-rose-600">{logoError}</p> : null}
              {logoMsg ? <p className="whitespace-pre-wrap text-sm text-emerald-700">{logoMsg}</p> : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={logoBusy || !logoFile}>
                  {logoBusy ? "Subiendo..." : "Guardar logo"}
                </Button>
                <Button type="button" variant="outline" onClick={removeLogo} disabled={logoBusy || !logoUrl}>
                  {logoBusy ? "Procesando..." : "Eliminar logo"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
