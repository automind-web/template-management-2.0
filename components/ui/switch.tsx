"use client";

import { cn } from "@/lib/utils";

/** Переключатель с подписью и пояснением. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4", disabled && "cursor-default opacity-60")}>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint ? <span className="mt-0.5 block text-sm text-muted-foreground">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors", checked ? "bg-primary" : "bg-[#d4d8e0]")}
      >
        <span className={cn("absolute left-0 top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
      </button>
    </label>
  );
}
