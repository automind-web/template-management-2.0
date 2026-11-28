"use client";

import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Диалог: фокус остаётся внутри, Esc закрывает, фокус возвращается на вызвавший элемент (Radix). */
export const Dialog = DialogPrimitive.Root;

export function DialogContent({
  className,
  children,
  title,
  description,
  footer,
  side = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string; footer?: React.ReactNode; side?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#1d2433]/45" />
      <DialogPrimitive.Content
        className={cn(
          side
            ? "task-sheet fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-2xl flex-col bg-surface shadow-2xl"
            : "sheet-up fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-2xl bg-surface shadow-2xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-3rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:[animation:none]",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-xl font-bold break-anywhere">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={description ? "mt-0.5 text-sm text-muted-foreground break-anywhere" : "sr-only"}>
              {description ?? title}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close className="-mr-1.5 inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground/70 hover:bg-muted" aria-label={t("app.close")}>
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
