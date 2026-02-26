import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-[var(--control-h)] w-full rounded-[var(--radius-md)] border border-[color:var(--input)] bg-[var(--card)] px-3 py-2 text-[13px] text-[var(--foreground)] sm:text-sm",
        "placeholder:text-[var(--muted-foreground)]/70",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]/35 focus-visible:border-[color:var(--ring)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";
