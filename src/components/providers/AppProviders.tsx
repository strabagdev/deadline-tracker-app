"use client";

import * as React from "react";
import { NotificationsProvider } from "@/components/ui/notifications";

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return <NotificationsProvider>{children}</NotificationsProvider>;
}
