import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess } from "@/lib/server/orgAccess";
import { BI_DATASETS, isBiDatasetKey } from "@/lib/reporting/datasets";

export const runtime = "nodejs";

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

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }

    const { data, error } = await db
      .from("reporting_endpoints")
      .select("id, slug, label, dataset_key, endpoint_token, is_active, created_at, updated_at")
      .eq("organization_id", access.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return NextResponse.json({
      datasets: BI_DATASETS,
      endpoints: (data ?? []).map((row) => ({
        id: String(row.id),
        slug: String(row.slug),
        label: String(row.label),
        dataset_key: String(row.dataset_key),
        endpoint_token: String(row.endpoint_token),
        is_active: Boolean(row.is_active),
        created_at: String(row.created_at),
        updated_at: String(row.updated_at),
      })),
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
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

    const { data, error } = await db
      .from("reporting_endpoints")
      .insert({
        organization_id: access.organizationId,
        slug,
        label,
        dataset_key: datasetKey,
        endpoint_token: makeToken(),
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;

    return NextResponse.json({ id: String(data?.id ?? "") }, { status: 201 });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
    }

    const id = String(new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id required", code: "BAD_REQUEST" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

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

    const { error } = await db
      .from("reporting_endpoints")
      .update(patch)
      .eq("organization_id", access.organizationId)
      .eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json(
        { error: access.error, code: access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN" },
        { status: access.error === "no active organization" ? 400 : 403 }
      );
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
