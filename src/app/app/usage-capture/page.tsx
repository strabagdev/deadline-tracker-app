"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { normalizeEntityTypeName } from "@/lib/usage-capture/slug";
import { USAGE_CAPTURE_SUBMODULE_PREFIX } from "@/lib/access/moduleKeys";

type EntityType = { id: string; name: string; icon?: string | null };

export default function UsageCapturePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);

  async function getTokenOrRedirect() {
    const { data } = await supabaseAuth.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return null;
    }
    return token;
  }

  async function load() {
    setLoading(true);
    setErrorMsg("");
    const token = await getTokenOrRedirect();
    if (!token) {
      setLoading(false);
      return;
    }

    const moduleRes = await fetch("/api/me/module-access", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const moduleJson = await moduleRes.json().catch(() => ({}));
    if (!moduleRes.ok) {
      setErrorMsg(moduleJson.error || "No se pudo validar acceso al módulo.");
      setEntityTypes([]);
      setLoading(false);
      return;
    }
    const allowedModules = Array.isArray(moduleJson.allowed_modules)
      ? moduleJson.allowed_modules.map((m: unknown) => String(m))
      : [];
    if (!allowedModules.includes("usage_capture")) {
      setLoading(false);
      router.replace("/app");
      return;
    }
    const scopedAllowed = allowedModules
      .filter((m: string) => m.startsWith(USAGE_CAPTURE_SUBMODULE_PREFIX))
      .map((m: string) => m.slice(USAGE_CAPTURE_SUBMODULE_PREFIX.length))
      .filter(Boolean);
    const scopedSet = new Set(scopedAllowed);
    const enforceScoped = scopedSet.size > 0;

    const res = await fetch("/api/entity-types", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErrorMsg(json.error || "No se pudieron cargar tipos de entidad.");
      setEntityTypes([]);
      setLoading(false);
      return;
    }

    const allTypes = (json.entity_types ?? []) as EntityType[];
    setEntityTypes(enforceScoped ? allTypes.filter((t) => scopedSet.has(String(t.id))) : allTypes);
    setLoading(false);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedTypes = useMemo(
    () => [...entityTypes].sort((a, b) => String(a.name).localeCompare(String(b.name), "es", { sensitivity: "base" })),
    [entityTypes]
  );

  return (
    <main className="mx-auto max-w-[1000px] space-y-4 px-4 py-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Captura Enfocada de Uso</CardTitle>
              <p className="mt-1 text-sm text-slate-500">Selecciona un tipo de entidad para ingresar usos en flujo acotado.</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/app/reports/usage"><Button variant="outline" size="sm">Reportes uso</Button></Link>
              <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>Refrescar</Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {errorMsg ? <p className="text-sm text-rose-600 whitespace-pre-wrap">{errorMsg}</p> : null}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Tipos disponibles</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex justify-center py-6"><Loader label="Cargando..." /></div>
          ) : sortedTypes.length === 0 ? (
            <p className="text-sm text-slate-500">No hay tipos de entidad disponibles.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {sortedTypes.map((type) => (
                <Link key={type.id} href={`/app/usage-capture/${encodeURIComponent(normalizeEntityTypeName(type.name))}`}>
                  <button
                    type="button"
                    className="w-full rounded-xl border bg-white p-3 text-left transition hover:bg-slate-50"
                  >
                    <div className="text-sm font-semibold text-slate-900">{type.name}</div>
                    <div className="text-xs text-slate-500">Abrir captura enfocada</div>
                  </button>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
