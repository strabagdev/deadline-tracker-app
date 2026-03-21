import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type PageHeroProps = {
  title: string;
  subtitle?: React.ReactNode;
  badge?: string;
  secondaryBadge?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export function PageHero({
  title,
  subtitle,
  badge,
  secondaryBadge,
  actions,
  footer,
  className,
}: PageHeroProps) {
  return (
    <section
      className={cn(
        "rounded-[26px] border border-[rgba(17,32,28,0.08)] bg-[linear-gradient(180deg,rgba(251,253,252,0.98),rgba(245,249,248,0.96))] p-4 shadow-[0_20px_60px_-44px_rgba(15,23,42,0.3)]",
        className
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {(badge || secondaryBadge) ? (
            <div className="flex flex-wrap items-center gap-2">
              {badge ? <Badge className="bg-slate-900 text-white hover:bg-slate-900">{badge}</Badge> : null}
              {secondaryBadge ? (
                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">
                  {secondaryBadge}
                </Badge>
              ) : null}
            </div>
          ) : null}
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
          {footer ? <div className="mt-2">{footer}</div> : null}
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
