"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYmd(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  const dt = new Date(y, mo - 1, da);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== da) return null;
  return dt;
}

function monthTitle(d: Date) {
  return d.toLocaleDateString("es", { month: "long", year: "numeric" });
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

type Props = {
  value: string;
  onChange: (next: string) => void;
  highlightedDates?: string[];
  disabledDates?: string[];
  label?: string;
  disabled?: boolean;
  showLegend?: boolean;
};

export function MarkedDatePicker({
  value,
  onChange,
  highlightedDates = [],
  disabledDates = [],
  label,
  disabled = false,
  showLegend = true,
}: Props) {
  const parsed = parseYmd(value);
  const [open, setOpen] = React.useState(false);
  const [viewMonth, setViewMonth] = React.useState<Date>(() => startOfMonth(parsed ?? new Date()));
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const dt = parseYmd(value);
    if (dt) setViewMonth(startOfMonth(dt));
  }, [value]);

  React.useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(ev.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const marked = React.useMemo(() => new Set(highlightedDates), [highlightedDates]);
  const disabledSet = React.useMemo(() => new Set(disabledDates), [disabledDates]);

  const monthStart = startOfMonth(viewMonth);
  const firstWeekday = (monthStart.getDay() + 6) % 7; // monday=0
  const count = daysInMonth(viewMonth);

  const cells: Array<{ ymd: string | null; day: number | null }> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push({ ymd: null, day: null });
  for (let day = 1; day <= count; day++) {
    const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
    cells.push({ ymd: toYmd(d), day });
  }
  while (cells.length % 7 !== 0) cells.push({ ymd: null, day: null });

  return (
    <div ref={rootRef} className="relative">
      {label ? <label className="mb-1 block text-xs text-slate-600">{label}</label> : null}
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        className="h-10 w-full justify-between bg-white"
        disabled={disabled}
      >
        <span>{value || "Selecciona fecha"}</span>
        <span className="text-xs text-slate-500">▼</span>
      </Button>

      {open ? (
        <div className="absolute z-50 mt-2 w-[280px] rounded-xl border bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
            >
              ◀
            </Button>
            <div className="text-sm font-medium capitalize">{monthTitle(viewMonth)}</div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
            >
              ▶
            </Button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center text-[10px] text-slate-500">
            <div>L</div><div>M</div><div>X</div><div>J</div><div>V</div><div>S</div><div>D</div>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((c, idx) => {
              if (!c.ymd || !c.day) return <div key={`e-${idx}`} className="h-8" />;
              const isSelected = c.ymd === value;
              const isMarked = marked.has(c.ymd);
              const isDisabled = disabled || disabledSet.has(c.ymd);
              return (
                <button
                  key={c.ymd}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => {
                    onChange(c.ymd as string);
                    setOpen(false);
                  }}
                  className={[
                    "h-8 rounded-md text-xs",
                    isSelected ? "border border-slate-500 bg-slate-900 text-white" : "border border-transparent hover:bg-slate-100",
                    isMarked && !isSelected ? "bg-emerald-100 text-emerald-900" : "",
                    isDisabled ? "cursor-not-allowed opacity-50" : "",
                  ].join(" ")}
                  title={isMarked ? "Fecha con registro" : undefined}
                >
                  {c.day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
            <span className="inline-flex min-h-4 items-center gap-1">
              {showLegend ? <><span className="inline-block h-2 w-2 rounded-full bg-emerald-300" /> Con registro</> : null}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const today = toYmd(new Date());
                onChange(today);
                setOpen(false);
              }}
            >
              Hoy
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
