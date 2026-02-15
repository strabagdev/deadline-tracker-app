import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";

const ORG_LOGO_BUCKET = "organization-assets";
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

async function getActiveOrganizationId(db: ReturnType<typeof createDataServerClient>, userId: string) {
  const { data, error } = await db
    .from("user_settings")
    .select("active_organization_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.active_organization_id ?? null;
}

async function getMembershipRole(
  db: ReturnType<typeof createDataServerClient>,
  userId: string,
  organizationId: string
) {
  const { data, error } = await db
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data?.role ?? null;
}

function buildLogoPath(organizationId: string, originalName: string) {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${organizationId}/logo_${Date.now()}_${safeName}`;
}

function extractBucketPathFromPublicUrl(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const raw = url.slice(idx + marker.length);
  return decodeURIComponent(raw);
}

async function ensureLogoBucket(db: ReturnType<typeof createDataServerClient>) {
  const { error } = await db.storage.getBucket(ORG_LOGO_BUCKET);
  if (!error) return;

  const { error: createError } = await db.storage.createBucket(ORG_LOGO_BUCKET, {
    public: true,
    fileSizeLimit: `${MAX_LOGO_SIZE_BYTES}`,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });

  if (createError && !String(createError.message).toLowerCase().includes("already exists")) {
    throw createError;
  }
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const organizationId = await getActiveOrganizationId(db, user.id);
    if (!organizationId) {
      return NextResponse.json({ organization: null, role: null });
    }

    const role = await getMembershipRole(db, user.id, organizationId);
    if (!role) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: organization, error: orgError } = await db
      .from("organizations")
      .select("id,name,logo_url")
      .eq("id", organizationId)
      .maybeSingle();

    if (orgError) throw orgError;

    return NextResponse.json({ organization: organization ?? null, role });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unauthorized";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const organizationId = await getActiveOrganizationId(db, user.id);
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    const role = await getMembershipRole(db, user.id, organizationId);
    if (role !== "owner") {
      return NextResponse.json({ error: "Only owner can update organization logo" }, { status: 403 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }

    if (file.size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      return NextResponse.json({ error: "El logo excede 2MB" }, { status: 400 });
    }
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Formato no permitido (PNG, JPG, WEBP, SVG)" }, { status: 400 });
    }

    const { data: organization, error: orgError } = await db
      .from("organizations")
      .select("logo_url,name")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!organization) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    await ensureLogoBucket(db);

    const logoPath = buildLogoPath(organizationId, file.name || "logo");
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const { data: uploaded, error: uploadError } = await db.storage
      .from(ORG_LOGO_BUCKET)
      .upload(logoPath, fileBuffer, {
        contentType: file.type,
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError || !uploaded) throw uploadError ?? new Error("Upload failed");

    const publicUrl = db.storage.from(ORG_LOGO_BUCKET).getPublicUrl(uploaded.path).data.publicUrl;

    const { data: updated, error: updateError } = await db
      .from("organizations")
      .update({ logo_url: publicUrl })
      .eq("id", organizationId)
      .select("id,name,logo_url")
      .maybeSingle();
    if (updateError) throw updateError;

    if (organization.logo_url) {
      const previousPath = extractBucketPathFromPublicUrl(organization.logo_url, ORG_LOGO_BUCKET);
      if (previousPath) {
        await db.storage.from(ORG_LOGO_BUCKET).remove([previousPath]);
      }
    }

    return NextResponse.json({ organization: updated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error updating logo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const organizationId = await getActiveOrganizationId(db, user.id);
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    const role = await getMembershipRole(db, user.id, organizationId);
    if (role !== "owner") {
      return NextResponse.json({ error: "Only owner can update organization logo" }, { status: 403 });
    }

    const { data: organization, error: orgError } = await db
      .from("organizations")
      .select("id,name,logo_url")
      .eq("id", organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    if (!organization) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const { data: updated, error: updateError } = await db
      .from("organizations")
      .update({ logo_url: null })
      .eq("id", organizationId)
      .select("id,name,logo_url")
      .maybeSingle();
    if (updateError) throw updateError;

    if (organization.logo_url) {
      const previousPath = extractBucketPathFromPublicUrl(organization.logo_url, ORG_LOGO_BUCKET);
      if (previousPath) {
        await db.storage.from(ORG_LOGO_BUCKET).remove([previousPath]);
      }
    }

    return NextResponse.json({ organization: updated });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Error removing logo";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
