"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SemaphoreSettingsPanel } from "@/components/semaphore/SemaphoreSettingsPanel";

export default function SemaphoreSettingsPage() {
  return (
    <main className="mx-auto max-w-[1100px] space-y-4 px-4 py-4">
      <SemaphoreSettingsPanel
        headerActions={
          <>
            <Link href="/app/entities">
              <Button variant="outline" size="sm">Entidades</Button>
            </Link>
            <Link href="/app">
              <Button variant="outline" size="sm">Dashboard</Button>
            </Link>
          </>
        }
      />
    </main>
  );
}
