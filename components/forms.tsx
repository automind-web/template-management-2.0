"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";
import { ApiError } from "@/lib/api";
import { errorText, fieldText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card } from "./ui/card";

/**
 * Отправка формы: блокирует повторное нажатие, хранит ошибку и ошибки полей.
 * Введённые данные при ошибке не теряются.
 */
export function useSubmit<T>(action: () => Promise<T>) {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const inFlight = React.useRef(false);
  const actionRef = React.useRef(action);
  actionRef.current = action;

  const run = React.useCallback(async (): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      return await actionRef.current();
    } catch (e) {
      if (e instanceof ApiError) {
        setFieldErrors(Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, fieldText(v) ?? v])));
        setError(errorText(e.code));
      } else {
        setError(errorText("internal"));
      }
      return undefined;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return { run, pending, error, fieldErrors, setError };
}

/** Страницы без входа: одна карточка по центру. */
export function AuthShell({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Card className="w-full max-w-[420px] p-6 sm:p-7">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{description}</p> : null}
        <div className="mt-5">{children}</div>
      </Card>
    </main>
  );
}

export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} className={cn("text-[15px] text-primary underline-offset-4 hover:underline", className)}>
      {children}
    </a>
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="flex gap-2">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="h-10 min-w-0 flex-1 rounded-md border border-input bg-muted px-3 font-mono text-xs"
        aria-label={t("app.link")}
      />
      <Button
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            /* буфер обмена недоступен — поле выделяется для ручного копирования */
          }
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? t("app.copied") : t("app.copy")}
      </Button>
    </div>
  );
}

export function LoadError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <p>{message ?? errorText("network")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("app.retry")}
      </Button>
    </div>
  );
}
