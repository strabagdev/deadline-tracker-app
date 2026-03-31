import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppProviders from "@/components/providers/AppProviders";

export const metadata: Metadata = {
  title: "OpsAhead",
  description: "OpsAhead platform",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/icon-oa.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/icon-oa.svg", type: "image/svg+xml" }],
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
      <body className="antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
