import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

async function getActiveOrgId(db: any, userId: string) {
  const { data, error } = await db
    .from("user_settings")
    .select("active_organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.active_organization_id as string) || null;
}

async function requireMember(db: any, organizationId: string, userId: string) {
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role ?? null;
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const url = new URL(req.url);
    const id = url.searchParams.get("id");

    // List
    if (!id) {
      const { data, error } = await db
        .from("entities")
        .select("id, name, entity_type_id, tracks_usage, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const entityRows = data ?? [];
      const typeIds = Array.from(new Set(entityRows.map((e: any) => e.entity_type_id)));

      let typeMap = new Map<string, string>();
      if (typeIds.length) {
        const { data: types, error: tErr } = await db
          .from("entity_types")
          .select("id, name")
          .eq("organization_id", orgId)
          .in("id", typeIds);

        if (tErr) throw tErr;
        (types ?? []).forEach((t: any) => typeMap.set(t.id, t.name));
      }

      const enriched = entityRows.map((e: any) => ({
        ...e,
        entity_type_name: typeMap.get(e.entity_type_id) ?? "",
      }));

      return NextResponse.json({ entities: enriched });
    }

    // Detail
    const { data: entity, error: eErr } = await db
      .from("entities")
      .select("id, name, entity_type_id, tracks_usage, created_at")
      .eq("organization_id", orgId)
      .eq("id", id)
      .maybeSingle();

    if (eErr) throw eErr;
    if (!entity) return NextResponse.json({ error: "not found" }, { status: 404 });

    const { data: entityType, error: etErr } = await db
      .from("entity_types")
      .select("id, name, icon")
      .eq("organization_id", orgId)
      .eq("id", entity.entity_type_id)
      .maybeSingle();

    if (etErr) throw etErr;

    const { data: fields, error: fErr } = await db
      .from("entity_fields")
      .select("id, name, key, field_type, show_in_card, options, created_at")
      .eq("organization_id", orgId)
      .eq("entity_type_id", entity.entity_type_id)
      .order("created_at", { ascending: true });

    if (fErr) throw fErr;

    const { data: values, error: vErr } = await db
      .from("entity_field_values")
      .select("entity_field_id, value_text, updated_at")
      .eq("organization_id", orgId)
      .eq("entity_id", entity.id);

    if (vErr) throw vErr;

    const valMap = new Map<string, any>();
    (values ?? []).forEach((v: any) => valMap.set(v.entity_field_id, v));

    const mergedFields = (fields ?? []).map((f: any) => ({
      ...f,
      value_text: valMap.get(f.id)?.value_text ?? "",
      value_updated_at: valMap.get(f.id)?.updated_at ?? null,
    }));

    return NextResponse.json({
      entity: {
        ...entity,
        entity_type: entityType ?? null,
        fields: mergedFields,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await requireMember(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const entityTypeId = String(body?.entity_type_id ?? "").trim();
    const tracksUsage = Boolean(body?.tracks_usage ?? false);
    const fieldValues = Array.isArray(body?.field_values) ? body.field_values : [];

    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (!entityTypeId) return NextResponse.json({ error: "entity_type_id required" }, { status: 400 });

    const { data: entity, error: insErr } = await db
      .from("entities")
      .insert({
        organization_id: orgId,
        entity_type_id: entityTypeId,
        name,
        tracks_usage: tracksUsage,
      })
      .select("id, name, entity_type_id, tracks_usage, created_at")
      .single();

    if (insErr) throw insErr;

    const rows = (fieldValues as any[])
      .map((fv) => ({
        entity_field_id: String(fv?.entity_field_id ?? "").trim(),
        value_text: fv?.value_text == null ? "" : String(fv.value_text),
      }))
      .filter((fv) => fv.entity_field_id && String(fv.value_text ?? "").trim() !== "")
      .map((fv) => ({
        organization_id: orgId,
        entity_id: entity.id,
        entity_field_id: fv.entity_field_id,
        value_text: String(fv.value_text).trim(),
      }));

    if (rows.length) {
      const { error: vErr } = await db.from("entity_field_values").insert(rows);
      if (vErr) throw vErr;
    }

    return NextResponse.json({ entity }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
