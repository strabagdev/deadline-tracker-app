import { NextResponse } from "next/server";

export async function GET() {
  const environment = String(process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development");
  const rawRev = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? "";
  const rev = rawRev ? String(rawRev).slice(0, 7) : null;
  return NextResponse.json({
    frontend_rev: rev,
    backend_rev: rev,
    environment,
  });
}
