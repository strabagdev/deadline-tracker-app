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

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();
    const access = await getOrgAccess(db, user.id);
    if ("error" in access) {
      return NextResponse.json({ error: access.error }, { status: access.error === "no active organization" ? 400 : 403 });
    }

    const { data, error } = await db
      .from("organization_settings")
      .select(
        "organization_id, yellow_days, orange_days, red_days, updated_at"
      )
      .eq("organization_id", access.organizationId)
      .maybeSingle();

    if (error) throw error;

    const settings =
      data ?? ({
        organization_id: access.organizationId,
        yellow_days: 60,
        orange_days: 30,
        red_days: 15,
        updated_at: null,
      } as const);

    return NextResponse.json({ organization_id: access.organizationId, role: access.role, settings });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
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
      return NextResponse.json({ error }, { status });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const yellow = Math.trunc(Number(body.yellow_days));
    const orange = Math.trunc(Number(body.orange_days));
    const red = Math.trunc(Number(body.red_days));

    const v = validateThresholds(yellow, orange, red);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    const { error: upErr } = await db.from("organization_settings").upsert(
      {
        organization_id: access.organizationId,
        yellow_days: yellow,
        orange_days: orange,
        red_days: red,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );

    if (upErr) throw upErr;

    const { data, error } = await db
      .from("organization_settings")
      .select(
        "organization_id, yellow_days, orange_days, red_days, updated_at"
      )
      .eq("organization_id", access.organizationId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ organization_id: access.organizationId, role: access.role, settings: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
