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
  density?: "default" | "compact";
};

export function PageHero({
  title,
  subtitle,
  badge,
  secondaryBadge,
  actions,
  footer,
  className,
  density = "default",
}: PageHeroProps) {
  return (
    <section
      className={cn(
        "rounded-[26px] border border-[rgba(36,58,86,0.14)] bg-[radial-gradient(circle_at_top_left,rgba(96,165,250,0.14),transparent_26%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.10),transparent_24%),linear-gradient(180deg,rgba(252,254,255,0.98),rgba(241,247,245,0.96))] shadow-[0_24px_70px_-46px_rgba(15,23,42,0.34)]",
        density === "compact" ? "rounded-[22px] px-4 py-3" : "p-4",
        className
      )}
    >
      <div className={cn("flex flex-col lg:flex-row lg:items-start lg:justify-between", density === "compact" ? "gap-2.5" : "gap-3")}>
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
          <h1
            className={cn(
              "font-semibold tracking-tight text-slate-950",
              density === "compact" ? "mt-1 text-[1.15rem] sm:text-[1.35rem]" : "mt-2 text-[1.35rem] sm:text-[1.75rem]"
            )}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              className={cn(
                "max-w-3xl text-slate-600",
                density === "compact" ? "mt-1 text-[13px] leading-5" : "mt-1.5 text-sm"
              )}
            >
              {subtitle}
            </p>
          ) : null}
          {footer ? <div className={cn(density === "compact" ? "mt-1.5" : "mt-2")}>{footer}</div> : null}
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
