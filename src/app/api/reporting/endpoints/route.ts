import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { canViewModule, getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import { BI_DATASETS, isBiDatasetKey } from "@/lib/reporting/datasets";

export const runtime = "nodejs";

type EndpointRecord = {
  id: string;
  slug: string;
  label: string;
  dataset_key: string;
  endpoint_token: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

function isMissingColumnError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("column") && (message.includes("does not exist") || message.includes("schema cache"));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function normalizeSlug(input: string) {
  return String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeToken() {
  const id = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, "");
  return id.slice(0, 32);
}

const SLUG_WORDS_A = [
  "alpha",
  "rapid",
  "clear",
  "smart",
  "north",
  "nova",
  "prime",
  "silver",
  "delta",
  "urban",
] as const;

const SLUG_WORDS_B = [
  "stream",
  "bridge",
  "insight",
  "pulse",
  "vector",
  "signal",
  "matrix",
  "scope",
  "report",
  "engine",
] as const;

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function makeRandomSlug() {
  return `${randomFrom(SLUG_WORDS_A)}-${randomFrom(SLUG_WORDS_B)}`;
}

async function listEndpoints(db: ReturnType<typeof createDataServerClient>, organizationId: string): Promise<EndpointRecord[]> {
  const current = await db
    .from("reporting_endpoints")
    .select("id, slug, name, dataset_key, token_hash, is_active, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (!current.error) {
    return (current.data ?? []).map((row) => ({
      id: String(row.id),
      slug: String(row.slug),
      label: String(row.name),
      dataset_key: String(row.dataset_key),
      endpoint_token: String(row.token_hash),
      is_active: Boolean(row.is_active),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    }));
  }

  if (!isMissingColumnError(current.error)) throw current.error;

  const legacy = await db
    .from("reporting_endpoints")
    .select("id, slug, label, dataset_key, endpoint_token, is_active, created_at, updated_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (legacy.error) throw legacy.error;

  return (legacy.data ?? []).map((row) => ({
    id: String(row.id),
    slug: String(row.slug),
    label: String(row.label),
    dataset_key: String(row.dataset_key),
    endpoint_token: String(row.endpoint_token),
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

async function insertEndpoint(
  db: ReturnType<typeof createDataServerClient>,
  values: { organization_id: string; slug: string; label: string; dataset_key: string; endpoint_token: string }
) {
  const hybrid = await db
    .from("reporting_endpoints")
    .insert({
      organization_id: values.organization_id,
      slug: values.slug,
      name: values.label,
      label: values.label,
      dataset_key: values.dataset_key,
      token_hash: values.endpoint_token,
      endpoint_token: values.endpoint_token,
      is_active: true,
    })
    .select("id")
    .single();

  if (!hybrid.error) return hybrid.data;
  if (!isMissingColumnError(hybrid.error)) throw hybrid.error;

  const current = await db
    .from("reporting_endpoints")
    .insert({
      organization_id: values.organization_id,
      slug: values.slug,
      name: values.label,
      dataset_key: values.dataset_key,
      token_hash: values.endpoint_token,
      is_active: true,
    })
    .select("id")
    .single();

  if (!current.error) return current.data;
  if (!isMissingColumnError(current.error)) throw current.error;

  const legacy = await db
    .from("reporting_endpoints")
    .insert({
      organization_id: values.organization_id,
      slug: values.slug,
      label: values.label,
      dataset_key: values.dataset_key,
      endpoint_token: values.endpoint_token,
      is_active: true,
    })
    .select("id")
    .single();
  if (legacy.error) throw legacy.error;
  return legacy.data;
}

async function updateEndpoint(
  db: ReturnType<typeof createDataServerClient>,
  organizationId: string,
  id: string,
  patch: {
    label?: string;
    slug?: string;
    dataset_key?: string;
    is_active?: boolean;
    endpoint_token?: string;
    updated_at: string;
  }
) {
  const hybridPatch: Record<string, unknown> = {
    updated_at: patch.updated_at,
  };
  if (patch.label != null) {
    hybridPatch.name = patch.label;
    hybridPatch.label = patch.label;
  }
  if (patch.slug != null) hybridPatch.slug = patch.slug;
  if (patch.dataset_key != null) hybridPatch.dataset_key = patch.dataset_key;
  if (patch.is_active != null) hybridPatch.is_active = patch.is_active;
  if (patch.endpoint_token != null) {
    hybridPatch.token_hash = patch.endpoint_token;
    hybridPatch.endpoint_token = patch.endpoint_token;
  }

  const hybrid = await db
    .from("reporting_endpoints")
    .update(hybridPatch)
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (!hybrid.error) return;
  if (!isMissingColumnError(hybrid.error)) throw hybrid.error;

  const currentPatch: Record<string, unknown> = { updated_at: patch.updated_at };
  if (patch.label != null) currentPatch.name = patch.label;
  if (patch.slug != null) currentPatch.slug = patch.slug;
  if (patch.dataset_key != null) currentPatch.dataset_key = patch.dataset_key;
  if (patch.is_active != null) currentPatch.is_active = patch.is_active;
  if (patch.endpoint_token != null) currentPatch.token_hash = patch.endpoint_token;

  const current = await db
    .from("reporting_endpoints")
    .update(currentPatch)
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (!current.error) return;
  if (!isMissingColumnError(current.error)) throw current.error;

  const legacyPatch: Record<string, unknown> = { updated_at: patch.updated_at };
  if (patch.label != null) legacyPatch.label = patch.label;
  if (patch.slug != null) legacyPatch.slug = patch.slug;
  if (patch.dataset_key != null) legacyPatch.dataset_key = patch.dataset_key;
  if (patch.is_active != null) legacyPatch.is_active = patch.is_active;
  if (patch.endpoint_token != null) legacyPatch.endpoint_token = patch.endpoint_token;

  const legacy = await db
    .from("reporting_endpoints")
    .update(legacyPatch)
    .eq("organization_id", organizationId)
    .eq("id", id);
  if (legacy.error) throw legacy.error;
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canBiIntegrations = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "bi_integrations"
    );
    if (!canBiIntegrations || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    return NextResponse.json({
      datasets: BI_DATASETS,
      endpoints: await listEndpoints(db, access.organizationId),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canBiIntegrations = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "bi_integrations"
    );
    if (!canBiIntegrations || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const label = String(body?.label ?? "").trim();
    const datasetKey = String(body?.dataset_key ?? "").trim();

    if (!label) return NextResponse.json({ error: "label required", code: "BAD_REQUEST" }, { status: 400 });
    if (!isBiDatasetKey(datasetKey)) {
      return NextResponse.json({ error: "invalid dataset_key", code: "BAD_REQUEST" }, { status: 400 });
    }

    let slug = normalizeSlug(String(body?.slug ?? ""));
    if (!slug) {
      // Genera slug random de 2 palabras con guion, único por organización.
      for (let i = 0; i < 25; i += 1) {
        const candidate = makeRandomSlug();
        const { data: exists, error: existsErr } = await db
          .from("reporting_endpoints")
          .select("id")
          .eq("organization_id", access.organizationId)
          .eq("slug", candidate)
          .maybeSingle();
        if (existsErr) throw existsErr;
        if (!exists?.id) {
          slug = candidate;
          break;
        }
      }
      if (!slug) {
        return NextResponse.json({ error: "could not generate unique slug", code: "INTERNAL_ERROR" }, { status: 500 });
      }
    }

    const data = await insertEndpoint(db, {
      organization_id: access.organizationId,
      slug,
      label,
      dataset_key: datasetKey,
      endpoint_token: makeToken(),
    });

    return NextResponse.json({ id: String(data?.id ?? "") }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canBiIntegrations = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "bi_integrations"
    );
    if (!canBiIntegrations || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const id = String(new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const patch: {
      label?: string;
      slug?: string;
      dataset_key?: string;
      is_active?: boolean;
      endpoint_token?: string;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    if (body?.label != null) {
      const label = String(body.label).trim();
      if (!label) return NextResponse.json({ error: "label cannot be empty", code: "BAD_REQUEST" }, { status: 400 });
      patch.label = label;
    }
    if (body?.slug != null) {
      const slug = normalizeSlug(String(body.slug));
      if (!slug) return NextResponse.json({ error: "slug cannot be empty", code: "BAD_REQUEST" }, { status: 400 });
      patch.slug = slug;
    }
    if (body?.dataset_key != null) {
      const datasetKey = String(body.dataset_key).trim();
      if (!isBiDatasetKey(datasetKey)) return NextResponse.json({ error: "invalid dataset_key", code: "BAD_REQUEST" }, { status: 400 });
      patch.dataset_key = datasetKey;
    }
    if (body?.is_active != null) patch.is_active = Boolean(body.is_active);
    if (body?.rotate_token === true) patch.endpoint_token = makeToken();

    await updateEndpoint(db, access.organizationId, id, patch);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }
    const canBiIntegrations = await canViewModule(
      db,
      access.organizationId,
      access.role,
      access.memberTypeId,
      "bi_integrations"
    );
    if (!canBiIntegrations || !isAdminRole(access.role)) {
      return NextResponse.json({ error: "forbidden", code: "FORBIDDEN" }, { status: 403 });
    }

    const id = String(new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const { error } = await db
      .from("reporting_endpoints")
      .delete()
      .eq("organization_id", access.organizationId)
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
