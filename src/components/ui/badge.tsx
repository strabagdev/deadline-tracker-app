import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline";

function variantClass(variant: BadgeVariant) {
  if (variant === "secondary") return "bg-[var(--accent-soft)] text-[var(--accent)]";
  if (variant === "outline") return "border border-[color:var(--border)] text-[var(--muted-foreground)]";
  return "bg-[var(--accent)] text-[var(--accent-foreground)]";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-[8px] px-2 py-0.5 text-[11px] font-medium sm:text-xs", variantClass(variant), className)}
      {...props}
    />
  );
}
