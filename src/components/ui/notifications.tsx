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
      shell: "border-emerald-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,252,247,0.96))] text-slate-950 shadow-[0_22px_54px_-30px_rgba(5,150,105,0.32)]",
      badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
      iconWrap: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100",
      progress: "bg-emerald-500",
      label: "Listo",
    };
  }
  if (tone === "error") {
    return {
      shell: "border-rose-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,244,246,0.96))] text-slate-950 shadow-[0_22px_54px_-30px_rgba(225,29,72,0.26)]",
      badge: "border-rose-200 bg-rose-50 text-rose-700",
      iconWrap: "bg-rose-50 text-rose-600 ring-1 ring-rose-100",
      progress: "bg-rose-500",
      label: "Error",
    };
  }
  if (tone === "warning") {
    return {
      shell: "border-amber-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(255,250,235,0.97))] text-slate-950 shadow-[0_22px_54px_-30px_rgba(217,119,6,0.26)]",
      badge: "border-amber-200 bg-amber-50 text-amber-700",
      iconWrap: "bg-amber-50 text-amber-600 ring-1 ring-amber-100",
      progress: "bg-amber-500",
      label: "Atención",
    };
  }
  return {
    shell: "border-sky-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(243,249,255,0.96))] text-slate-950 shadow-[0_22px_54px_-30px_rgba(2,132,199,0.24)]",
    badge: "border-sky-200 bg-sky-50 text-sky-700",
    iconWrap: "bg-sky-50 text-sky-600 ring-1 ring-sky-100",
    progress: "bg-sky-500",
    label: "Actualización",
  };
}

function ToneIcon({ tone }: { tone: NotificationTone }) {
  if (tone === "success") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (tone === "error") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </svg>
    );
  }
  if (tone === "warning") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01" />
      <path d="M11 12h1v4h1" />
    </svg>
  );
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
        "pointer-events-auto w-full overflow-hidden rounded-[24px] border backdrop-blur-xl transition-all duration-200",
        palette.shell
      )}
      role={item.tone === "error" ? "alert" : "status"}
      aria-live={item.tone === "error" ? "assertive" : "polite"}
    >
      <div className={cn("h-1 w-full", palette.progress, "opacity-90")} />
      <div className="flex items-start gap-3 p-3.5">
        <div className={cn("mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", palette.iconWrap)}>
          <ToneIcon tone={item.tone} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]", palette.badge)}>
              {palette.label}
            </span>
            <p className="text-[15px] font-semibold leading-5 text-slate-900">{item.title}</p>
          </div>
          {item.description ? (
            <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-5 text-slate-600">{item.description}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900/5 text-base leading-none text-slate-400 transition hover:bg-slate-900/10 hover:text-slate-800"
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
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[220] flex w-auto flex-col gap-3 sm:bottom-5 sm:right-5 sm:left-auto sm:w-[440px]">
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
