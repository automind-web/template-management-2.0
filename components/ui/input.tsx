import { ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-sm font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-danger";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(control, "control-h", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(control, "min-h-24 py-2.5", className)} {...props} />;
}

/** Нативный список: на телефоне открывает системный выбор, удобный для касания. */
export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full min-w-0", className)}>
      <select data-slot="select" className={cn(control, "control-h cursor-pointer appearance-none pr-9")} {...props} />
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("text-[13px] font-semibold text-foreground/75", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm text-foreground", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input type="checkbox" className="size-[18px] shrink-0 cursor-pointer rounded accent-[var(--am-accent)]" {...props} />
      <span>{label}</span>
    </label>
  );
}
