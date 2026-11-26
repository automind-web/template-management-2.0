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
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { title: string; description?: string; footer?: React.ReactNode }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#1c1e24]/45" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-xl bg-surface shadow-xl sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:max-w-xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={description ? "mt-0.5 text-sm text-muted-foreground" : "sr-only"}>
              {description ?? title}
            </DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close className="-m-1 rounded-md p-1 text-foreground/70 hover:bg-muted" aria-label={t("app.close")}>
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
