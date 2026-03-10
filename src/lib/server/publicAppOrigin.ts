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

function getEnvOrigin() {
  return trimTrailingSlash(
    String(
      process.env.SITE_URL ??
        process.env.APP_URL ??
        process.env.NEXT_PUBLIC_APP_URL ??
        ""
    ).trim()
  );
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

  const envOrigin = getEnvOrigin();
  if (envOrigin) return envOrigin;

  return reqOrigin || "http://localhost:3000";
}

export function getPublicAppUrl(req: Request, path: string): string {
  const origin = getPublicAppOrigin(req);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}
