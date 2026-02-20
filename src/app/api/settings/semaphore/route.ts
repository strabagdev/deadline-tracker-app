import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { getAdminOrgAccess, getOrgAccess } from "@/lib/server/orgAccess";

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : "error";
}

function validateThresholds(y: number, o: number, r: number) {
  if (![y, o, r].every((n) => Number.isFinite(n))) return "valores inválidos";
  if (y < 0 || o < 0 || r < 0) return "no puede haber valores negativos";
  if (y > 3650 || o > 3650 || r > 3650) return "valor demasiado alto (máx 3650)";
  if (!(y >= o && o >= r)) return "debe ser yellow ≥ orange ≥ red";
  return "";
}

function normalizeLabel(value: unknown, fallback: string): string {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : fallback;
}

function validateLabels(labels: { green: string; yellow: string; orange: string; red: string }) {
  const values = [labels.green, labels.yellow, labels.orange, labels.red];
  if (values.some((v) => v.length === 0)) return "los nombres no pueden estar vacíos";
  if (values.some((v) => v.length > 40)) return "los nombres no pueden exceder 40 caracteres";
  return "";
}

function isMissingColumnError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? String((err as { code?: unknown }).code ?? "") : "";
  return code === "42703";
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

    const { data, error } = await db
      .from("organization_settings")
      .select(
        "organization_id, yellow_days, orange_days, red_days, label_green, label_yellow, label_orange, label_red, updated_at"
      )
      .eq("organization_id", access.organizationId)
      .maybeSingle();

    if (error && !isMissingColumnError(error)) throw error;

    let settings = data as
      | {
          organization_id: string;
          yellow_days: number;
          orange_days: number;
          red_days: number;
          label_green?: string | null;
          label_yellow?: string | null;
          label_orange?: string | null;
          label_red?: string | null;
          updated_at: string | null;
        }
      | null;

    if (error && isMissingColumnError(error)) {
      const { data: legacyData, error: legacyError } = await db
        .from("organization_settings")
        .select("organization_id, yellow_days, orange_days, red_days, updated_at")
        .eq("organization_id", access.organizationId)
        .maybeSingle();
      if (legacyError) throw legacyError;
      settings = legacyData
        ? {
            ...legacyData,
            label_green: "Al día",
            label_yellow: "Aviso",
            label_orange: "Por vencer",
            label_red: "Vencido",
          }
        : null;
    }

    const safeSettings =
      settings ?? ({
        organization_id: access.organizationId,
        yellow_days: 60,
        orange_days: 30,
        red_days: 15,
        label_green: "Al día",
        label_yellow: "Aviso",
        label_orange: "Por vencer",
        label_red: "Vencido",
        updated_at: null,
      } as const);

    return NextResponse.json({ organization_id: access.organizationId, role: access.role, settings: safeSettings });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getAdminOrgAccess(db, user.id);
    if ("error" in access) {
      const status = access.error === "no active organization" ? 400 : 403;
      const error = access.error === "forbidden" ? "admin/owner only" : access.error;
      const code = access.error === "no active organization" ? "NO_ACTIVE_ORGANIZATION" : "FORBIDDEN";
      return NextResponse.json({ error, code }, { status });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const yellow = Math.trunc(Number(body.yellow_days));
    const orange = Math.trunc(Number(body.orange_days));
    const red = Math.trunc(Number(body.red_days));
    const labels = {
      green: normalizeLabel(body.label_green, "Al día"),
      yellow: normalizeLabel(body.label_yellow, "Aviso"),
      orange: normalizeLabel(body.label_orange, "Por vencer"),
      red: normalizeLabel(body.label_red, "Vencido"),
    };

    const v = validateThresholds(yellow, orange, red);
    if (v) return NextResponse.json({ error: v, code: "BAD_REQUEST" }, { status: 400 });
    const lv = validateLabels(labels);
    if (lv) return NextResponse.json({ error: lv, code: "BAD_REQUEST" }, { status: 400 });

    const upsertPayload = {
      organization_id: access.organizationId,
      yellow_days: yellow,
      orange_days: orange,
      red_days: red,
      label_green: labels.green,
      label_yellow: labels.yellow,
      label_orange: labels.orange,
      label_red: labels.red,
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await db.from("organization_settings").upsert(
      upsertPayload,
      { onConflict: "organization_id" }
    );

    if (upErr && isMissingColumnError(upErr)) {
      const { error: legacyUpErr } = await db.from("organization_settings").upsert(
        {
          organization_id: access.organizationId,
          yellow_days: yellow,
          orange_days: orange,
          red_days: red,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" }
      );
      if (legacyUpErr) throw legacyUpErr;
    } else if (upErr) {
      throw upErr;
    }

    const { data, error } = await db
      .from("organization_settings")
      .select(
        "organization_id, yellow_days, orange_days, red_days, label_green, label_yellow, label_orange, label_red, updated_at"
      )
      .eq("organization_id", access.organizationId)
      .maybeSingle();

    if (error && !isMissingColumnError(error)) throw error;

    if (error && isMissingColumnError(error)) {
      const { data: legacyData, error: legacyError } = await db
        .from("organization_settings")
        .select("organization_id, yellow_days, orange_days, red_days, updated_at")
        .eq("organization_id", access.organizationId)
        .maybeSingle();
      if (legacyError) throw legacyError;
      return NextResponse.json({
        organization_id: access.organizationId,
        role: access.role,
        settings: legacyData
          ? {
              ...legacyData,
              label_green: "Al día",
              label_yellow: "Aviso",
              label_orange: "Por vencer",
              label_red: "Vencido",
            }
          : null,
      });
    }

    return NextResponse.json({ organization_id: access.organizationId, role: access.role, settings: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
