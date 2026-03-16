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

function isLocalOrigin(value: string) {
  return value.includes("localhost") || value.includes("127.0.0.1");
}

export function getPublicAppOrigin(req: Request): string {
  const envOrigin = getEnvOrigin();

  const forwardedHost = String(req.headers.get("x-forwarded-host") ?? "")
    .split(",")[0]
    .trim();
  const forwardedProto = String(req.headers.get("x-forwarded-proto") ?? "")
    .split(",")[0]
    .trim();

  if (envOrigin && !isLocalOrigin(envOrigin)) return envOrigin;

  if (forwardedHost) {
    const proto = forwardedProto || "https";
    const forwardedOrigin = `${proto}://${forwardedHost}`;
    if (!isLocalOrigin(forwardedOrigin) || !envOrigin) return forwardedOrigin;
  }

  const reqOrigin = safeOriginFromUrl(req.url);
  if (reqOrigin && !isLocalOrigin(reqOrigin)) return reqOrigin;

  if (envOrigin) return envOrigin;

  return reqOrigin || "http://localhost:3000";
}

export function getPublicAppUrl(req: Request, path: string): string {
  const origin = getPublicAppOrigin(req);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalizedPath}`;
}
