"use client";

import type { LucideIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Плавный счётчик для чисел сводки (без анимации при reduce-motion). */
export function useCountUp(target: number) {
  const [value, setValue] = React.useState(0);
  React.useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const frame = requestAnimationFrame(() => setValue(target));
      return () => cancelAnimationFrame(frame);
    }
    const start = performance.now();
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / 450);
      setValue(Math.round(target * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return value;
}

const TONES = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/12 text-success",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/15 text-warning",
};

/** Плитка сводки — как на главной шаблона продаж: подпись, значок, крупное число и пояснение. */
export function StatTile({
  index = 0,
  icon: Icon,
  label,
  value,
  hint,
  tone = "primary",
  active,
  onClick,
  loading,
}: {
  index?: number;
  icon: LucideIcon;
  label: string;
  value: number;
  hint?: string;
  tone?: keyof typeof TONES;
  active?: boolean;
  onClick?: () => void;
  loading?: boolean;
}) {
  const shown = useCountUp(loading ? 0 : value);
  const cls = cn(
    "rise-in lift block w-full rounded-2xl border bg-surface p-4 text-left shadow-[0_1px_2px_#1d24330a] sm:p-5",
    active ? "border-primary ring-2 ring-primary/15" : "border-border",
    onClick && "cursor-pointer",
  );
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-foreground/70">{label}</span>
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", TONES[tone])}>
          <Icon className="size-[18px]" />
        </span>
      </span>
      <span className={cn("mt-2 block text-[30px] font-bold leading-tight tracking-tight tabular-nums", tone === "danger" && value > 0 && "text-danger")}>{loading ? "–" : shown}</span>
      {hint ? <span className="mt-1 block truncate text-[13px] text-muted-foreground">{hint}</span> : null}
    </>
  );
  const style = { "--i": index } as React.CSSProperties;
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls} style={style}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
