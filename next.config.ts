import type { NextConfig } from "next";

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

export default nextConfig;
