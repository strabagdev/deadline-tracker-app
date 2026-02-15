import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { isSuperAdmin } from "@/lib/server/superAdmin";

const PLATFORM_LOGO_BUCKET = "platform-assets";
const MAX_LOGO_SIZE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

type PlatformSettingsRow = {
  platform_logo_url: string | null;
};

function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  return maybe.code === "42P01" || (maybe.message || "").toLowerCase().includes("does not exist");
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

function buildLogoPath(originalName: string) {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `platform/logo_${Date.now()}_${safeName}`;
}

function extractBucketPathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const raw = url.slice(idx + marker.length);
  return decodeURIComponent(raw);
}

async function ensurePlatformLogoBucket(db: ReturnType<typeof createDataServerClient>) {
  const { error } = await db.storage.getBucket(PLATFORM_LOGO_BUCKET);
  if (!error) return;

  const { error: createError } = await db.storage.createBucket(PLATFORM_LOGO_BUCKET, {
    public: true,
    fileSizeLimit: `${MAX_LOGO_SIZE_BYTES}`,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });

  if (createError && !String(createError.message).toLowerCase().includes("already exists")) {
    throw createError;
  }
}

async function getCurrentSettings(db: ReturnType<typeof createDataServerClient>) {
  const { data, error } = await db
    .from("platform_settings")
    .select("platform_logo_url")
    .eq("id", true)
    .maybeSingle();

  if (error) throw error;
  return (data as PlatformSettingsRow | null) ?? null;
}

export async function GET(req: Request) {
  try {
    await requireAuthUser(req);
    const db = createDataServerClient();

    let settings: PlatformSettingsRow | null = null;
    try {
      settings = await getCurrentSettings(db);
    } catch (error: unknown) {
      if (!isMissingTableError(error)) throw error;
    }
    return NextResponse.json({
      platform: {
        logo_url: settings?.platform_logo_url ?? null,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only" }, { status: 403 });

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      return NextResponse.json({ error: "El logo excede 4MB" }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Formato no permitido (PNG, JPG, WEBP, SVG)" }, { status: 400 });
    }

    const current = await getCurrentSettings(db);
    await ensurePlatformLogoBucket(db);

    const logoPath = buildLogoPath(file.name || "platform_logo");
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { data: uploaded, error: uploadError } = await db.storage
      .from(PLATFORM_LOGO_BUCKET)
      .upload(logoPath, fileBuffer, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError || !uploaded) throw uploadError ?? new Error("Upload failed");

    const publicUrl = db.storage.from(PLATFORM_LOGO_BUCKET).getPublicUrl(uploaded.path).data.publicUrl;

    const { data: updated, error: updateError } = await db
      .from("platform_settings")
      .upsert(
        {
          id: true,
          platform_logo_url: publicUrl,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select("platform_logo_url")
      .maybeSingle();
    if (updateError) throw updateError;

    if (current?.platform_logo_url) {
      const previousPath = extractBucketPathFromPublicUrl(current.platform_logo_url, PLATFORM_LOGO_BUCKET);
      if (previousPath) {
        await db.storage.from(PLATFORM_LOGO_BUCKET).remove([previousPath]);
      }
    }

    return NextResponse.json({
      platform: {
        logo_url: updated?.platform_logo_url ?? null,
      },
    });
  } catch (error: unknown) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Missing table platform_settings. Run supabase/004_platform_branding.sql" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const allowed = await isSuperAdmin(db, user.id);
    if (!allowed) return NextResponse.json({ error: "super admin only" }, { status: 403 });

    const current = await getCurrentSettings(db);
    const { data: updated, error: updateError } = await db
      .from("platform_settings")
      .upsert(
        {
          id: true,
          platform_logo_url: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      )
      .select("platform_logo_url")
      .maybeSingle();
    if (updateError) throw updateError;

    if (current?.platform_logo_url) {
      const previousPath = extractBucketPathFromPublicUrl(current.platform_logo_url, PLATFORM_LOGO_BUCKET);
      if (previousPath) {
        await db.storage.from(PLATFORM_LOGO_BUCKET).remove([previousPath]);
      }
    }

    return NextResponse.json({
      platform: {
        logo_url: updated?.platform_logo_url ?? null,
      },
    });
  } catch (error: unknown) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        { error: "Missing table platform_settings. Run supabase/004_platform_branding.sql" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}
