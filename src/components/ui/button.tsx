import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "ghost" | "outline" | "destructive";
type ButtonSize = "default" | "sm" | "lg" | "icon";

function variantClass(variant: ButtonVariant) {
  if (variant === "secondary") return "bg-[var(--accent-soft)] text-[var(--accent)] hover:brightness-95";
  if (variant === "ghost") return "bg-transparent text-[var(--muted-foreground)] hover:bg-[var(--muted)]";
  if (variant === "outline") return "border border-[color:var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:bg-[var(--muted)]";
  if (variant === "destructive") return "bg-[var(--danger)] text-[var(--danger-foreground)] hover:brightness-95";
  return "bg-[var(--accent)] text-[var(--accent-foreground)] hover:brightness-95";
}

function sizeClass(size: ButtonSize) {
  if (size === "sm") return "h-8 px-3 text-[11px] sm:h-9 sm:text-xs";
  if (size === "lg") return "h-[var(--control-h-lg)] px-6 text-sm";
  if (size === "icon") return "h-[var(--control-h)] w-[var(--control-h)]";
  return "h-[var(--control-h)] px-4 text-[13px] sm:text-sm";
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]/35 focus-visible:border-[color:var(--ring)]",
        "disabled:pointer-events-none disabled:opacity-50",
        variantClass(variant),
        sizeClass(size),
        className
      )}
      {...props}
    />
  )
);

Button.displayName = "Button";
