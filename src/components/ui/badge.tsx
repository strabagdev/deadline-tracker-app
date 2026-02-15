import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "outline";

function variantClass(variant: BadgeVariant) {
  if (variant === "secondary") return "bg-slate-100 text-slate-700";
  if (variant === "outline") return "border border-slate-300 text-slate-700";
  return "bg-slate-900 text-white";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", variantClass(variant), className)}
      {...props}
    />
  );
}
