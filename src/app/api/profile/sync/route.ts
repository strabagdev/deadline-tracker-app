import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);

    const email = (user.email || "").trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "No email on auth user" }, { status: 400 });
    }

    const db = createDataServerClient();

    const { error } = await db.from("profiles").upsert({
      user_id: user.id,
      email,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true, user_id: user.id, email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "error" }, { status: 500 });
  }
}