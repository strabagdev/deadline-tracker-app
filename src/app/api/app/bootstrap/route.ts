import { NextResponse } from "next/server";
import { requireAuthUser } from "@/lib/server/requireAuthUser";
import { createDataServerClient } from "@/lib/supabase/dataServer";
import { defaultModulesByRole, getOrgAccess } from "@/lib/server/orgAccess";
import { getSuperAdminStatus } from "@/lib/server/superAdmin";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "error";
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthUser(req);
    const db = createDataServerClient();

    const [superStatus, platformSettings] = await Promise.all([
      getSuperAdminStatus(db, user.id),
      db
        .from("platform_settings")
        .select("platform_logo_url")
        .eq("id", true)
        .maybeSingle(),
    ]);

    if (platformSettings.error) throw platformSettings.error;

    if (superStatus.isCurrentSuperAdmin) {
      return NextResponse.json({
        session: {
          email: user.email ?? "",
        },
        platform: {
          logo_url: platformSettings.data?.platform_logo_url ?? null,
        },
        access: {
          has_super_admin: superStatus.hasSuperAdmin,
          is_super_admin: true,
          active_organization: null,
          allowed_modules: null,
        },
      });
    }

    const access = await getOrgAccess(db, user.id);
    if ("error" in access && access.error !== "no active organization") {
      return NextResponse.json({ error: access.error, code: "FORBIDDEN" }, { status: 403 });
    }

    let activeOrganization: { id: string; name: string; logo_url: string | null } | null = null;
    let allowedModules: string[] | null = null;

    if (!("error" in access)) {
      const [orgResult, moduleResult] = await Promise.all([
        db
          .from("organizations")
          .select("id, name, logo_url")
          .eq("id", access.organizationId)
          .maybeSingle(),
        access.memberTypeId
          ? db
              .from("organization_member_type_modules")
              .select("module_key, can_view")
              .eq("organization_id", access.organizationId)
              .eq("member_type_id", access.memberTypeId)
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (orgResult.error) throw orgResult.error;
      if (moduleResult.error) throw moduleResult.error;

      activeOrganization = orgResult.data
        ? {
            id: String(orgResult.data.id),
            name: String(orgResult.data.name ?? ""),
            logo_url: orgResult.data.logo_url ? String(orgResult.data.logo_url) : null,
          }
        : null;

      if (!access.memberTypeId) {
        allowedModules = defaultModulesByRole(access.role);
      } else {
        const rows = moduleResult.data ?? [];
        const modules = rows
          .filter((row) => Boolean(row.can_view))
          .map((row) => String(row.module_key))
          .filter((value, index, arr) => arr.indexOf(value) === index);
        allowedModules = modules.length > 0 ? modules : defaultModulesByRole(access.role);
      }
    }

    return NextResponse.json({
      session: {
        email: user.email ?? "",
      },
      platform: {
        logo_url: platformSettings.data?.platform_logo_url ?? null,
      },
      access: {
        has_super_admin: superStatus.hasSuperAdmin,
        is_super_admin: false,
        active_organization: activeOrganization,
        allowed_modules: allowedModules,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: getErrorMessage(error), code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
