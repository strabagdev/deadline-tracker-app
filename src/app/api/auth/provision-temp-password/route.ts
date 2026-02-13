import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAuthUser } from "@/lib/server/requireAuthUser";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function generateTempPassword(length = 14) {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const nums = "23456789";
  const symbols = "!@#$%";
  const all = upper + lower + nums + symbols;

  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];

  const base = [pick(upper), pick(lower), pick(nums), pick(symbols)];
  while (base.length < length) base.push(pick(all));

  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }

  return base.join("");
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);

    const shouldProvision = Boolean(user.user_metadata?.needs_temp_password);
    if (!shouldProvision) {
      return NextResponse.json({ created: false });
    }

    const tempPassword = generateTempPassword();

    const authAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_AUTH_URL!,
      process.env.SUPABASE_AUTH_SERVICE_ROLE_KEY!
    );

    const nextUserMetadata = {
      ...(user.user_metadata || {}),
      needs_temp_password: false,
      temp_password_created_at: new Date().toISOString(),
    };

    const { error } = await authAdmin.auth.admin.updateUserById(user.id, {
      password: tempPassword,
      user_metadata: nextUserMetadata,
    });

    if (error) throw error;

    return NextResponse.json({ created: true, temporary_password: tempPassword });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
