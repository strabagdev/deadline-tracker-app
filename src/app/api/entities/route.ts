import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess, isAdminRole } from "@/lib/server/orgAccess";
import {
  handleEntitiesDelete,
  handleEntitiesPost,
  handleEntitiesPut,
  type EntitiesRepo,
} from "@/lib/api/entitiesService";

/**
 * Phase 1.3
 * - Adds PUT (update entity + upsert field values) and DELETE (remove entity)
 * - Uses query param ?id= to avoid dynamic route type validation issues.
 */

type EntityRow = {
  id: string;
  name: string;
  entity_type_id: string;
  tracks_usage: boolean;
  created_at: string;
};

type EntityTypeRow = {
  id: string;
  name: string;
};

type EntityFieldRow = {
  id: string;
  name: string;
  key: string;
  field_type: string;
  show_in_card: boolean;
  options: unknown;
  created_at: string;
};

type EntityFieldValueRow = {
  entity_field_id: string;
  value_text: string;
  updated_at: string | null;
};

type DataClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function makeRepo(db: DataClient): EntitiesRepo {
  return {
    createEntity: async (orgId, input) => {
      const { data: entity, error: insErr } = await db
        .from("entities")
        .insert({
          organization_id: orgId,
          entity_type_id: input.entityTypeId,
          name: input.name,
          tracks_usage: input.tracksUsage,
        })
        .select("id, name, entity_type_id, tracks_usage, created_at")
        .single();
      if (insErr) throw insErr;
      return entity as {
        id: string;
        name: string;
        entity_type_id: string;
        tracks_usage: boolean;
        created_at: string;
      };
    },
    insertFieldValues: async (rows) => {
      const { error } = await db.from("entity_field_values").insert(rows);
      if (error) throw error;
    },
    getEntityById: async (orgId, id) => {
      const { data, error } = await db
        .from("entities")
        .select("id")
        .eq("organization_id", orgId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    updateEntity: async (orgId, id, patch) => {
      const { error } = await db
        .from("entities")
        .update(patch)
        .eq("organization_id", orgId)
        .eq("id", id);
      if (error) throw error;
    },
    upsertFieldValues: async (rows) => {
      const { error } = await db
        .from("entity_field_values")
        .upsert(rows, { onConflict: "entity_id,entity_field_id" });
      if (error) throw error;
    },
    deleteFieldValues: async (orgId, entityId, fieldIds) => {
      const { error } = await db
        .from("entity_field_values")
        .delete()
        .eq("organization_id", orgId)
        .eq("entity_id", entityId)
        .in("entity_field_id", fieldIds);
      if (error) throw error;
    },
    deleteEntity: async (orgId, id) => {
      const { error } = await db
        .from("entities")
        .delete()
        .eq("organization_id", orgId)
        .eq("id", id);
      if (error) throw error;
    },
  };
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
    const orgId = access.organizationId;

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

      const entityRows = (data ?? []) as EntityRow[];
      const typeIds = Array.from(new Set(entityRows.map((e) => e.entity_type_id)));

      const typeMap = new Map<string, string>();
      if (typeIds.length) {
        const { data: types, error: tErr } = await db
          .from("entity_types")
          .select("id, name")
          .eq("organization_id", orgId)
          .in("id", typeIds);

        if (tErr) throw tErr;
        ((types ?? []) as EntityTypeRow[]).forEach((t) => typeMap.set(t.id, t.name));
      }

      const enriched = entityRows.map((e) => ({
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
    if (!entity) return NextResponse.json({ error: "not found", code: "ENTITY_NOT_FOUND" }, { status: 404 });

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

    const valMap = new Map<string, EntityFieldValueRow>();
    ((values ?? []) as EntityFieldValueRow[]).forEach((v) => valMap.set(v.entity_field_id, v));

    const mergedFields = ((fields ?? []) as EntityFieldRow[]).map((f) => ({
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
    const body = await req.json().catch(() => ({}));
    const response = await handleEntitiesPost(access.organizationId, body, makeRepo(db));
    return NextResponse.json(response.body, { status: response.status });
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
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const body = await req.json().catch(() => ({}));
    const response = await handleEntitiesPut(access.organizationId, id ?? "", body, makeRepo(db));
    return NextResponse.json(response.body, { status: response.status });
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
    if (!isAdminRole(access.role)) {
      return NextResponse.json({ error: "admin/owner only", code: "FORBIDDEN" }, { status: 403 });
    }
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const response = await handleEntitiesDelete(access.organizationId, id ?? "", makeRepo(db));
    return NextResponse.json(response.body, { status: response.status });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
