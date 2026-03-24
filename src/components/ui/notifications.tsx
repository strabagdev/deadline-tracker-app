"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type NotificationTone = "success" | "error" | "info" | "warning";

type NotificationItem = {
  id: string;
  tone: NotificationTone;
  title: string;
  description?: string;
  durationMs: number;
};

type NotifyInput =
  | string
  | {
      title: string;
      description?: string;
      durationMs?: number;
    };

type NotificationsContextValue = {
  notify: (tone: NotificationTone, input: NotifyInput) => string;
  success: (input: NotifyInput) => string;
  error: (input: NotifyInput) => string;
  info: (input: NotifyInput) => string;
  warning: (input: NotifyInput) => string;
  dismiss: (id: string) => void;
};

const NotificationsContext = React.createContext<NotificationsContextValue | null>(null);

function normalizeInput(input: NotifyInput) {
  if (typeof input === "string") {
    return { title: input, description: "", durationMs: 4200 };
  }
  return {
    title: String(input.title ?? "").trim(),
    description: String(input.description ?? "").trim(),
    durationMs: Math.max(1800, Number(input.durationMs ?? 4200) || 4200),
  };
}

function toneClasses(tone: NotificationTone) {
  if (tone === "success") {
    return {
      shell: "border-emerald-200/90 bg-[linear-gradient(180deg,rgba(236,253,245,0.98),rgba(209,250,229,0.92))] text-emerald-950 shadow-[0_18px_40px_-28px_rgba(5,150,105,0.5)]",
      badge: "border-emerald-300/90 bg-emerald-100 text-emerald-700",
      dot: "bg-emerald-500",
      label: "Correcto",
    };
  }
  if (tone === "error") {
    return {
      shell: "border-rose-200/90 bg-[linear-gradient(180deg,rgba(255,241,242,0.98),rgba(255,228,230,0.94))] text-rose-950 shadow-[0_18px_40px_-28px_rgba(225,29,72,0.42)]",
      badge: "border-rose-300/90 bg-rose-100 text-rose-700",
      dot: "bg-rose-500",
      label: "Error",
    };
  }
  if (tone === "warning") {
    return {
      shell: "border-amber-200/90 bg-[linear-gradient(180deg,rgba(255,251,235,0.98),rgba(254,243,199,0.94))] text-amber-950 shadow-[0_18px_40px_-28px_rgba(217,119,6,0.42)]",
      badge: "border-amber-300/90 bg-amber-100 text-amber-700",
      dot: "bg-amber-500",
      label: "Atencion",
    };
  }
  return {
    shell: "border-sky-200/90 bg-[linear-gradient(180deg,rgba(240,249,255,0.98),rgba(224,242,254,0.94))] text-sky-950 shadow-[0_18px_40px_-28px_rgba(2,132,199,0.42)]",
    badge: "border-sky-300/90 bg-sky-100 text-sky-700",
    dot: "bg-sky-500",
    label: "Info",
  };
}

function NotificationCard({
  item,
  onDismiss,
}: {
  item: NotificationItem;
  onDismiss: () => void;
}) {
  const palette = toneClasses(item.tone);
  return (
    <div
      className={cn(
        "pointer-events-auto w-full overflow-hidden rounded-[22px] border p-3 backdrop-blur-xl transition-all duration-200",
        palette.shell
      )}
      role={item.tone === "error" ? "alert" : "status"}
      aria-live={item.tone === "error" ? "assertive" : "polite"}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full">
          <span className={cn("h-2.5 w-2.5 rounded-full", palette.dot)} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]", palette.badge)}>
              {palette.label}
            </span>
            <p className="text-sm font-semibold leading-5">{item.title}</p>
          </div>
          {item.description ? (
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-5 text-current/78">{item.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/5 bg-white/65 text-base leading-none text-slate-500 transition hover:bg-white hover:text-slate-900"
          aria-label="Cerrar notificacion"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<NotificationItem[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = React.useCallback((tone: NotificationTone, input: NotifyInput) => {
    const normalized = normalizeInput(input);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextItem: NotificationItem = {
      id,
      tone,
      title: normalized.title,
      description: normalized.description || undefined,
      durationMs: normalized.durationMs,
    };
    setItems((current) => [...current, nextItem].slice(-5));
    return id;
  }, []);

  React.useEffect(() => {
    if (items.length === 0) return;
    const timers = items.map((item) =>
      window.setTimeout(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      }, item.durationMs)
    );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [items]);

  const contextValue = React.useMemo<NotificationsContextValue>(
    () => ({
      notify,
      success: (input) => notify("success", input),
      error: (input) => notify("error", input),
      info: (input) => notify("info", input),
      warning: (input) => notify("warning", input),
      dismiss,
    }),
    [dismiss, notify]
  );

  return (
    <NotificationsContext.Provider value={contextValue}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[220] flex w-auto flex-col gap-3 sm:mx-auto sm:max-w-[420px]">
        {items.map((item) => (
          <NotificationCard key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </NotificationsContext.Provider>
  );
}

export function useNotify() {
  const context = React.useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotify must be used within NotificationsProvider");
  }
  return context;
}
