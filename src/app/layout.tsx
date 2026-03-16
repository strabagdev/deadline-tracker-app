import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpsAhead",
  description: "OpsAhead platform",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/api/platform/pwa-icon?size=192", type: "image/png" },
      { url: "/api/platform/pwa-icon?size=512", type: "image/png" },
    ],
    apple: [{ url: "/api/platform/pwa-icon?size=192", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "OpsAhead",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">{children}</body>
    </html>
  );
}
