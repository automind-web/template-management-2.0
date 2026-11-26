"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./input";

/** Поле формы: подпись, подсказка, ошибка (связаны через aria-describedby). */
export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }>;
}) {
  const id = React.useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, { id, "aria-invalid": Boolean(error) || undefined, "aria-describedby": describedBy })}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-[13px] font-medium text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
