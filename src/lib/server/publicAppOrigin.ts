function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function safeOriginFromUrl(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function getPublicAppOrigin(req: Request): string {
  const forwardedHost = String(req.headers.get("x-forwarded-host") ?? "")
    .split(",")[0]
    .trim();
  const forwardedProto = String(req.headers.get("x-forwarded-proto") ?? "")
    .split(",")[0]
    .trim();

  if (forwardedHost) {
    const proto = forwardedProto || "https";
    return `${proto}://${forwardedHost}`;
  }

  const reqOrigin = safeOriginFromUrl(req.url);
  if (reqOrigin && !reqOrigin.includes("localhost")) return reqOrigin;

  const envOrigin = trimTrailingSlash(String(process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "").trim());
  if (envOrigin) return envOrigin;

  return reqOrigin || "http://localhost:3000";
}
