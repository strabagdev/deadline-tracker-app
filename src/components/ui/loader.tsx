import { cn } from "@/lib/utils";

type LoaderProps = {
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
};

function sizeClass(size: LoaderProps["size"]) {
  if (size === "sm") return "h-4 w-4 border-2";
  if (size === "lg") return "h-8 w-8 border-[3px]";
  return "h-6 w-6 border-2";
}

export function Loader({ label = "Cargando", className, size = "md" }: LoaderProps) {
  return (
    <span className={cn("inline-flex items-center gap-3 text-slate-600", className)} role="status" aria-live="polite">
      <span
        className={cn(
          "inline-block animate-spin rounded-full border-slate-300 border-t-slate-700",
          sizeClass(size)
        )}
        aria-hidden
      />
      <span className="text-sm">{label}</span>
    </span>
  );
}
