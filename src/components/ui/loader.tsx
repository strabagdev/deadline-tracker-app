import { cn } from "@/lib/utils";

type LoaderProps = {
  label?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
};

function sizeClass(size: LoaderProps["size"]) {
  if (size === "sm") {
    return {
      wrap: "gap-2",
      track: "h-1 w-24",
      fill: "h-1",
      text: "text-xs",
    };
  }
  if (size === "lg") {
    return {
      wrap: "gap-3",
      track: "h-2 w-48",
      fill: "h-2",
      text: "text-base",
    };
  }
  return {
    wrap: "gap-2.5",
    track: "h-1.5 w-36",
    fill: "h-1.5",
    text: "text-sm",
  };
}

export function Loader({ label = "Cargando", className, size = "md", showLabel = false }: LoaderProps) {
  const styles = sizeClass(size);
  return (
    <span
      className={cn("inline-flex flex-col items-center justify-center text-slate-600", styles.wrap, className)}
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span
        className={cn(
          "relative overflow-hidden rounded-full bg-slate-200/90",
          styles.track
        )}
        aria-hidden
      >
        <span
          className={cn(
            "absolute left-0 top-0 rounded-full bg-gradient-to-r from-slate-500 via-slate-700 to-slate-500 shadow-[0_0_16px_rgba(51,65,85,0.28)]",
            styles.fill
          )}
          style={{
            width: "42%",
            animation: "loader-progress 1.25s ease-in-out infinite",
          }}
        />
      </span>
      {showLabel ? <span className={cn("text-slate-500", styles.text)}>{label}</span> : null}
      <style jsx>{`
        @keyframes loader-progress {
          0% {
            transform: translateX(-110%);
          }
          50% {
            transform: translateX(80%);
          }
          100% {
            transform: translateX(220%);
          }
        }
      `}</style>
    </span>
  );
}
