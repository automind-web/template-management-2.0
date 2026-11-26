import * as React from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full min-w-0 rounded-md border border-input bg-surface text-[15px] text-foreground placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-destructive";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" className={cn(control, "h-10 px-3", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(control, "min-h-20 px-3 py-2", className)} {...props} />;
}

export function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(control, "h-10 pl-3 pr-8", className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("text-[13px] font-semibold text-foreground/75", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: Omit<React.ComponentProps<"input">, "type"> & { label: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-[15px]", props.disabled && "cursor-default opacity-70", className)}>
      <input type="checkbox" className="size-[18px] shrink-0 accent-[var(--am-accent)]" {...props} />
      <span>{label}</span>
    </label>
  );
}
