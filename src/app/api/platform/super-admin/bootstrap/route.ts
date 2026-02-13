import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { bootstrapFirstSuperAdmin } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const body = await req.json().catch(() => ({}));
    const confirmEmail = String(body.confirmEmail || "").trim().toLowerCase();
    const authEmail = String(user.email || "").trim().toLowerCase();

    if (!authEmail) {
      return NextResponse.json({ error: "Authenticated user has no email" }, { status: 400 });
    }

    if (!confirmEmail || confirmEmail !== authEmail) {
      return NextResponse.json(
        { error: "Debes confirmar exactamente el correo autenticado para crear el super admin." },
        { status: 400 }
      );
    }

    const result = await bootstrapFirstSuperAdmin(db, user.id, authEmail);

    if (!result.created && !result.alreadySuperAdmin) {
      return NextResponse.json({ error: "super admin already exists" }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      created: result.created,
      is_super_admin: true,
      user_id: user.id,
      email: user.email ?? null,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
