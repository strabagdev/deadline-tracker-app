import { redirect } from "next/navigation";

export default async function LegacyUsageCaptureRedirect({
  params,
}: {
  params: Promise<{ entityTypeName: string }>;
}) {
  const resolved = await params;
  const entityTypeName = encodeURIComponent(String(resolved?.entityTypeName ?? "").trim());
  redirect(`/app/usage-capture/${entityTypeName}`);
}

