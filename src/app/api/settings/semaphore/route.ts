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

async function getMemberRole(db: any, organizationId: string, userId: string) {
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.role as string) || null;
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

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await getMemberRole(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const { data, error } = await db
      .from("organization_settings")
      .select(
        "organization_id, date_yellow_days, date_orange_days, date_red_days, usage_yellow_days, usage_orange_days, usage_red_days, updated_at"
      )
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) throw error;

    const settings =
      data ?? ({
        organization_id: orgId,
        date_yellow_days: 60,
        date_orange_days: 30,
        date_red_days: 15,
        usage_yellow_days: 60,
        usage_orange_days: 30,
        usage_red_days: 15,
        updated_at: null,
      } as const);

    return NextResponse.json({ organization_id: orgId, role, settings });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const orgId = await getActiveOrgId(db, user.id);
    if (!orgId) return NextResponse.json({ error: "no active organization" }, { status: 400 });

    const role = await getMemberRole(db, orgId, user.id);
    if (!role) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "admin/owner only" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const dateYellow = Math.trunc(Number(body.date_yellow_days));
    const dateOrange = Math.trunc(Number(body.date_orange_days));
    const dateRed = Math.trunc(Number(body.date_red_days));

    const usageYellow = Math.trunc(Number(body.usage_yellow_days));
    const usageOrange = Math.trunc(Number(body.usage_orange_days));
    const usageRed = Math.trunc(Number(body.usage_red_days));

    const vDate = validateThresholds(dateYellow, dateOrange, dateRed);
    if (vDate) return NextResponse.json({ error: `FECHA: ${vDate}` }, { status: 400 });

    const vUsage = validateThresholds(usageYellow, usageOrange, usageRed);
    if (vUsage) return NextResponse.json({ error: `USO: ${vUsage}` }, { status: 400 });

    const { error: upErr } = await db.from("organization_settings").upsert(
      {
        organization_id: orgId,
        date_yellow_days: dateYellow,
        date_orange_days: dateOrange,
        date_red_days: dateRed,
        usage_yellow_days: usageYellow,
        usage_orange_days: usageOrange,
        usage_red_days: usageRed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );

    if (upErr) throw upErr;

    const { data, error } = await db
      .from("organization_settings")
      .select(
        "organization_id, date_yellow_days, date_orange_days, date_red_days, usage_yellow_days, usage_orange_days, usage_red_days, updated_at"
      )
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ organization_id: orgId, role, settings: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}
