import { NextResponse } from "next/server";
import { createDataServerClient } from "@/lib/supabase/dataServer";

function fallbackIconUrl(req: Request, size: string) {
  const icon = size === "192" ? "/icons/icon-192.png" : "/icons/icon-512.png";
  return new URL(icon, req.url).toString();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const size = String(url.searchParams.get("size") ?? "512").trim() === "192" ? "192" : "512";
    const db = createDataServerClient();
    const { data, error } = await db
      .from("platform_settings")
      .select("platform_logo_url")
      .eq("id", true)
      .maybeSingle();

    if (error) {
      return NextResponse.redirect(fallbackIconUrl(req, size));
    }

    const logoUrl = String((data as { platform_logo_url?: string | null } | null)?.platform_logo_url ?? "").trim();
    if (!logoUrl) {
      return NextResponse.redirect(fallbackIconUrl(req, size));
    }

    return NextResponse.redirect(logoUrl);
  } catch {
    return NextResponse.redirect(fallbackIconUrl(req, "512"));
  }
}
