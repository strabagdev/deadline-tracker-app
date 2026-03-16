import { NextResponse } from "next/server";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { buildBiDatasetRows, isBiDatasetKey } from "@/lib/reporting/datasets";

export const runtime = "nodejs";

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

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  try {
    const db = createDataServerClient();
    const { slug } = await ctx.params;
    const endpointSlug = String(slug ?? "").trim().toLowerCase();
    const url = new URL(req.url);
    const endpointToken = String(url.searchParams.get("token") ?? "").trim();

    if (!endpointSlug) return NextResponse.json({ error: "slug required", code: "BAD_REQUEST" }, { status: 400 });
    if (!endpointToken) return unauthorized("token required");

    const { data, error } = await db
      .from("reporting_endpoints")
      .select("organization_id, slug, name, dataset_key, token_hash, is_active")
      .eq("slug", endpointSlug)
      .eq("token_hash", endpointToken)
      .maybeSingle();
    if (error) throw error;
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
