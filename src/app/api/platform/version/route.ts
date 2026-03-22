import { NextResponse } from "next/server";

export async function GET() {
  const environment = String(process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development");
  const rawPushRev = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "";
  const rawBuildRev =
    process.env.VERCEL_DEPLOYMENT_ID ??
    process.env.NEXT_BUILD_ID ??
    process.env.BUILD_ID ??
    rawPushRev;
  const pushRev = rawPushRev ? String(rawPushRev).slice(0, 7) : null;
  const buildRev = rawBuildRev ? String(rawBuildRev).slice(0, 7) : null;
  return NextResponse.json({
    app_name: "OpsAhead",
    build_rev: buildRev,
    push_rev: pushRev,
    openai_powered: Boolean(String(process.env.OPENAI_API_KEY ?? "").trim()),
    environment,
  });
}
