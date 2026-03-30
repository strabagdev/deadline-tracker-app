"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseAuth } from "@/lib/supabase/authClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { PageHero } from "@/components/PageHero";
import { normalizeEntityTypeName } from "@/lib/usage-capture/slug";
import { USAGE_CAPTURE_SUBMODULE_PREFIX } from "@/lib/access/moduleKeys";

type EntityType = { id: string; name: string; icon?: string | null };

const RECENT_USAGE_TYPES_KEY = "usage-capture-recent-types";

export default function UsageCapturePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [entityTypes, setEntityTypes] = useState<EntityType[]>([]);
  const [search, setSearch] = useState("");
  const [recentTypeIds, setRecentTypeIds] = useState<string[]>([]);

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
  const filteredTypes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return sortedTypes;
    return sortedTypes.filter((type) => String(type.name).toLowerCase().includes(needle));
  }, [search, sortedTypes]);
  const recentTypes = useMemo(() => {
    const byId = new Map(filteredTypes.map((type) => [String(type.id), type]));
    return recentTypeIds
      .map((id) => byId.get(id) ?? null)
      .filter((type): type is EntityType => Boolean(type));
  }, [filteredTypes, recentTypeIds]);
  const remainingTypes = useMemo(() => {
    const recentSet = new Set(recentTypes.map((type) => String(type.id)));
    return filteredTypes.filter((type) => !recentSet.has(String(type.id)));
  }, [filteredTypes, recentTypes]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_USAGE_TYPES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        setRecentTypeIds(parsed.map((value) => String(value)).filter(Boolean).slice(0, 6));
      }
    } catch {
      setRecentTypeIds([]);
    }
  }, []);

  function rememberType(typeId: string) {
    const next = [typeId, ...recentTypeIds.filter((id) => id !== typeId)].slice(0, 6);
    setRecentTypeIds(next);
    try {
      window.localStorage.setItem(RECENT_USAGE_TYPES_KEY, JSON.stringify(next));
    } catch {}
  }

  function renderTypeCard(type: EntityType, emphasis: "recent" | "default") {
    return (
      <Link
        key={type.id}
        href={`/app/usage-capture/${encodeURIComponent(normalizeEntityTypeName(type.name))}`}
        onClick={() => rememberType(String(type.id))}
      >
        <button
          type="button"
          className={[
            "group w-full rounded-[20px] border p-4 text-left transition",
            emphasis === "recent"
              ? "border-slate-300 bg-[linear-gradient(180deg,#ffffff,#f8fbff)] shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)] hover:border-slate-400 hover:bg-white"
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80",
          ].join(" ")}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                {emphasis === "recent" ? "Continuar" : "Tipo de entidad"}
              </div>
              <div className="mt-1 truncate text-base font-semibold text-slate-950">{type.name}</div>
              <div className="mt-2 text-sm leading-5 text-slate-500">
                {emphasis === "recent"
                  ? "Retoma una captura usada recientemente sin volver a buscar."
                  : "Abre la captura enfocada y trabaja pendientes o registros guardados."}
              </div>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {emphasis === "recent" ? "Reciente" : "Disponible"}
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-500">Ingreso enfocado por fecha y entidad</div>
            <div className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 transition group-hover:text-slate-950">
              Abrir captura
              <span aria-hidden>→</span>
            </div>
          </div>
        </button>
      </Link>
    );
  }

  return (
    <main className="mx-auto max-w-[1000px] space-y-4 px-4 py-4">
      <PageHero
        badge="Uso"
        secondaryBadge="Captura"
        title="Ingreso General de Uso"
        subtitle="Elige el tipo de entidad desde un hub pensado para retomar trabajo y entrar rápido a la captura enfocada."
        density="compact"
        actions={
          <>
            <Link href="/app/reports/usage"><Button variant="outline" size="sm">Reportes uso</Button></Link>
            <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>Refrescar</Button>
          </>
        }
      />

      {errorMsg ? <p className="text-sm text-rose-600 whitespace-pre-wrap">{errorMsg}</p> : null}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-base">Hub de captura</CardTitle>
              <p className="text-sm text-slate-500">
                Busca un tipo, entra por acceso reciente o navega el catálogo completo.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar tipo de entidad..."
                disabled={loading}
              />
              <div className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {loading ? "Cargando tipos..." : `${filteredTypes.length} tipo${filteredTypes.length === 1 ? "" : "s"} visible${filteredTypes.length === 1 ? "" : "s"}`}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex min-h-[60vh] items-center justify-center py-6"><Loader label="Cargando..." /></div>
          ) : sortedTypes.length === 0 ? (
            <p className="text-sm text-slate-500">No hay tipos de entidad disponibles.</p>
          ) : filteredTypes.length === 0 ? (
            <div className="rounded-[18px] border border-dashed border-slate-300 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-500">
              No hay coincidencias para <b>{search}</b>.
            </div>
          ) : (
            <div className="grid gap-5">
              {recentTypes.length > 0 ? (
                <section className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Continuar donde quedaste</div>
                      <div className="text-xs text-slate-500">Accesos recientes para volver al trabajo sin navegar todo el catálogo.</div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                      {recentTypes.length} reciente{recentTypes.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {recentTypes.map((type) => renderTypeCard(type, "recent"))}
                  </div>
                </section>
              ) : null}

              <section className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Todos los tipos</div>
                    <div className="text-xs text-slate-500">Entrada general para escalar la captura sin perder orden.</div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                    {remainingTypes.length} disponibles
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {remainingTypes.map((type) => renderTypeCard(type, "default"))}
                </div>
              </section>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
