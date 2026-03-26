import { NextResponse } from "next/server";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { buildBiDatasetRows, isBiDatasetKey } from "@/lib/reporting/datasets";

export const runtime = "nodejs";

type EndpointLookup =
  | {
      organization_id: string;
      slug: string;
      name: string;
      dataset_key: string;
      token_hash: string;
      is_active: boolean;
    }
  | null;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return "error";
}

function unauthorized(message: string) {
  return NextResponse.json({ error: message, code: "UNAUTHORIZED" }, { status: 401 });
}

function isMissingColumnError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("column") && (message.includes("does not exist") || message.includes("schema cache"));
}

async function findEndpointBySlugAndToken(
  db: ReturnType<typeof createDataServerClient>,
  endpointSlug: string,
  endpointToken: string
): Promise<EndpointLookup> {
  const current = await db
    .from("reporting_endpoints")
    .select("organization_id, slug, name, dataset_key, token_hash, is_active")
    .eq("slug", endpointSlug)
    .eq("token_hash", endpointToken)
    .maybeSingle();

  if (!current.error) {
    return current.data
      ? {
          organization_id: String(current.data.organization_id),
          slug: String(current.data.slug),
          name: String(current.data.name ?? ""),
          dataset_key: String(current.data.dataset_key ?? ""),
          token_hash: String(current.data.token_hash ?? ""),
          is_active: Boolean(current.data.is_active),
        }
      : null;
  }
  if (!isMissingColumnError(current.error)) throw current.error;

  const legacy = await db
    .from("reporting_endpoints")
    .select("organization_id, slug, label, dataset_key, endpoint_token, is_active")
    .eq("slug", endpointSlug)
    .eq("endpoint_token", endpointToken)
    .maybeSingle();
  if (legacy.error) throw legacy.error;

  return legacy.data
    ? {
        organization_id: String(legacy.data.organization_id),
        slug: String(legacy.data.slug),
        name: String(legacy.data.label ?? ""),
        dataset_key: String(legacy.data.dataset_key ?? ""),
        token_hash: String(legacy.data.endpoint_token ?? ""),
        is_active: Boolean(legacy.data.is_active),
      }
    : null;
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const db = createDataServerClient();
    const { slug } = await ctx.params;
    const endpointSlug = String(slug ?? "").trim().toLowerCase();
    const url = new URL(req.url);
    const endpointToken = String(url.searchParams.get("token") ?? "").trim();

    if (!endpointSlug) return NextResponse.json({ error: "slug required", code: "BAD_REQUEST" }, { status: 400 });
    if (!endpointToken) return unauthorized("token required");

    const data = await findEndpointBySlugAndToken(db, endpointSlug, endpointToken);
    if (!data) return NextResponse.json({ error: "endpoint not found", code: "NOT_FOUND" }, { status: 404 });
    if (!Boolean(data.is_active)) return NextResponse.json({ error: "endpoint inactive", code: "FORBIDDEN" }, { status: 403 });
    const datasetKey = String(data.dataset_key ?? "").trim();
    if (!isBiDatasetKey(datasetKey)) {
      return NextResponse.json({ error: "invalid endpoint dataset", code: "BAD_REQUEST" }, { status: 400 });
    }

    const orgId = String(data.organization_id);
    const built = await buildBiDatasetRows(db, orgId, datasetKey, url.searchParams);

    return NextResponse.json({
      meta: {
        organization_id: orgId,
        endpoint_slug: String(data.slug),
        endpoint_label: String(data.name ?? ""),
        dataset_key: datasetKey,
        dataset_note:
          datasetKey === "usage_logs"
            ? "Incluye value/value_text, usage_field_values y entity_profile."
            : datasetKey === "usage_logs_flat"
              ? "Incluye columnas planas con prefijos entity_profile__* y usage_field__*."
            : datasetKey === "deadlines_current"
              ? "Incluye vencimientos vigentes por entidad."
              : "Incluye forecast computado de vencimientos.",
        limit: built.limit,
        offset: built.offset,
        returned_rows: built.rows.length,
        generated_at: new Date().toISOString(),
      },
      rows: built.rows,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
