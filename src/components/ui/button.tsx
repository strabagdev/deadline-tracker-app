import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "ghost" | "outline" | "destructive";
type ButtonSize = "default" | "sm" | "lg" | "icon";

function variantClass(variant: ButtonVariant) {
  if (variant === "secondary") return "bg-slate-100 text-slate-900 hover:bg-slate-200";
  if (variant === "ghost") return "bg-transparent text-slate-700 hover:bg-slate-100";
  if (variant === "outline") return "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
  if (variant === "destructive") return "bg-rose-600 text-white hover:bg-rose-700";
  return "bg-slate-900 text-white hover:bg-slate-800";
}

function sizeClass(size: ButtonSize) {
  if (size === "sm") return "h-8 px-3 text-xs";
  if (size === "lg") return "h-11 px-6 text-sm";
  if (size === "icon") return "h-10 w-10";
  return "h-10 px-4 text-sm";
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
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
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
