import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getOrgAccess } from "@/lib/server/orgAccess";
import { handleDashboardGet, type DashboardRepo } from "@/lib/api/dashboardService";

type DataClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "error";
}

function makeDashboardRepo(db: DataClient): DashboardRepo {
  return {
    listEntitiesWithDeadlines: async (orgId) => {
      const { data, error } = await db
        .from("entities")
        .select(
          `
          id,
          name,
          created_at,
          entity_type_id,
          tracks_usage,
          entity_types(id, name),
          deadlines(
            id,
            entity_id,
            deadline_type_id,
            last_done_date,
            next_due_date,
            last_done_usage,
            frequency,
            frequency_unit,
            usage_daily_average,
            usage_daily_average_mode,
            created_at,
            deadline_types(id, name, measure_by, requires_document, is_active)
          )
        `
        )
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        name: string;
        created_at: string;
        entity_type_id: string | null;
        tracks_usage: boolean;
        entity_types?: { id: string; name: string } | null;
        deadlines?: Array<{
          id: string;
          entity_id: string;
          deadline_type_id: string;
          last_done_date: string | null;
          next_due_date: string | null;
          last_done_usage: number | null;
          frequency: number | null;
          frequency_unit: string | null;
          usage_daily_average: number | null;
          usage_daily_average_mode: string | null;
          created_at: string;
          deadline_types?: {
            id: string;
            name: string;
            measure_by: "date" | "usage";
            requires_document: boolean;
            is_active: boolean;
          } | null;
          measure_by?: "date" | "usage" | null;
        }> | null;
      }>;
    },
    getLatestUsageByEntity: async (orgId, entityIds) => {
      const entries = await Promise.all(
        entityIds.map(async (entityId) => {
          const { data, error } = await db
            .from("usage_logs")
            .select("value, logged_at")
            .eq("organization_id", orgId)
            .eq("entity_id", entityId)
            .order("logged_at", { ascending: false })
            .limit(1);

          if (error) throw error;

          const row = (data ?? [])[0];
          if (!row) return null;
          return [entityId, { value: Number(row.value), logged_at: String(row.logged_at) }] as const;
        })
      );

      const out: Record<string, { value: number; logged_at: string }> = {};
      for (const entry of entries) {
        if (entry) out[entry[0]] = entry[1];
      }
      return out;
    },
    getRecentUsageLogsByEntity: async (orgId, entityIds, sinceIso) => {
      const out: Record<string, Array<{ value: unknown; logged_at: unknown }>> = {};
      if (entityIds.length === 0) return out;

      const { data, error } = await db
        .from("usage_logs")
        .select("entity_id, value, logged_at")
        .eq("organization_id", orgId)
        .in("entity_id", entityIds)
        .gte("logged_at", sinceIso)
        .order("logged_at", { ascending: true })
        .limit(10000);

      if (error) throw error;

      for (const row of (data ?? []) as Array<{ entity_id: string; value: unknown; logged_at: unknown }>) {
        if (!out[row.entity_id]) out[row.entity_id] = [];
        out[row.entity_id].push({ value: row.value, logged_at: row.logged_at });
      }

      return out;
    },
    getCardFieldsByEntity: async (orgId, entityIds) => {
      const out: Record<
        string,
        Array<{ name: string; value_text: string; show_in_card: boolean; created_at: string | null }>
      > = {};
      if (entityIds.length === 0) return out;

      const { data: values, error: valuesError } = await db
        .from("entity_field_values")
        .select("entity_id, entity_field_id, value_text")
        .eq("organization_id", orgId)
        .in("entity_id", entityIds);

      if (valuesError) throw valuesError;

      const fieldIds = Array.from(
        new Set(
          ((values ?? []) as Array<{ entity_field_id: string | null }>)
            .map((v) => v.entity_field_id)
            .filter((id): id is string => Boolean(id))
        )
      );
      if (fieldIds.length === 0) return out;

      const { data: fields, error: fieldsError } = await db
        .from("entity_fields")
        .select("id, name, show_in_card, created_at")
        .eq("organization_id", orgId)
        .in("id", fieldIds);

      if (fieldsError) throw fieldsError;

      const fieldMap = new Map<
        string,
        { name: string; show_in_card: boolean; created_at: string | null }
      >();
      for (const field of (fields ?? []) as Array<{
        id: string;
        name: string;
        show_in_card: boolean;
        created_at: string | null;
      }>) {
        fieldMap.set(field.id, {
          name: String(field.name ?? ""),
          show_in_card: Boolean(field.show_in_card),
          created_at: field.created_at ?? null,
        });
      }

      for (const row of (values ?? []) as Array<{
        entity_id: string;
        entity_field_id: string | null;
        value_text: string | null;
      }>) {
        if (!row.entity_field_id) continue;
        const field = fieldMap.get(row.entity_field_id);
        if (!field) continue;
        if (!out[row.entity_id]) out[row.entity_id] = [];
        out[row.entity_id].push({
          name: field.name,
          show_in_card: field.show_in_card,
          created_at: field.created_at,
          value_text: String(row.value_text ?? ""),
        });
      }

      return out;
    },
  };
}

/**
 * Dashboard: returns entities with deadlines already computed, so frontend doesn't duplicate logic.
 */
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

    const response = await handleDashboardGet(access.organizationId, access.role, makeDashboardRepo(db));
    return NextResponse.json(response.body, { status: response.status });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
