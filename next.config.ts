import type { NextConfig } from "next";
const withPWA =
  (() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nextPWA = require("next-pwa");
      return nextPWA({
        dest: "public",
        disable: process.env.NODE_ENV === "development",
        register: true,
        skipWaiting: true,
      });
    } catch {
      return (config: NextConfig) => config;
    }
  })() as (config: NextConfig) => NextConfig;

function hostnameFromUrl(value?: string) {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const supabaseHostnames = Array.from(
  new Set(
    [
      hostnameFromUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
      hostnameFromUrl(process.env.NEXT_PUBLIC_DATA_SUPABASE_URL),
      hostnameFromUrl(process.env.NEXT_PUBLIC_AUTH_SUPABASE_URL),
    ].filter((h): h is string => Boolean(h))
  )
);

const nextConfig: NextConfig = {
  reactCompiler: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            // HSTS in app layer as fallback if upstream proxy/CDN is bypassed.
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      ...supabaseHostnames.map((hostname) => ({
        protocol: "https" as const,
        hostname,
        pathname: "/storage/v1/object/public/**",
      })),
    ],
  },
};

export default withPWA(nextConfig);
