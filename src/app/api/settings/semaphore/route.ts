import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

type DataClient = ReturnType<typeof createDataServerClient>;

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : "error";
}

async function getActiveOrgId(db: DataClient, userId: string) {
  const { data, error } = await db
    .from("user_settings")
    .select("active_organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data?.active_organization_id as string) || null;
}

async function getMemberRole(db: DataClient, organizationId: string, userId: string) {
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
        "organization_id, yellow_days, orange_days, red_days, updated_at"
      )
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) throw error;

    const settings =
      data ?? ({
        organization_id: orgId,
        yellow_days: 60,
        orange_days: 30,
        red_days: 15,
        updated_at: null,
      } as const);

    return NextResponse.json({ organization_id: orgId, role, settings });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
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

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const yellow = Math.trunc(Number(body.yellow_days ?? body.date_yellow_days ?? body.usage_yellow_days));
    const orange = Math.trunc(Number(body.orange_days ?? body.date_orange_days ?? body.usage_orange_days));
    const red = Math.trunc(Number(body.red_days ?? body.date_red_days ?? body.usage_red_days));

    const v = validateThresholds(yellow, orange, red);
    if (v) return NextResponse.json({ error: v }, { status: 400 });

    const { error: upErr } = await db.from("organization_settings").upsert(
      {
        organization_id: orgId,
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
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) throw error;

    return NextResponse.json({ organization_id: orgId, role, settings: data });
  } catch (e: unknown) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}
