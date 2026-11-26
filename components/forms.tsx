"use client";

import { Copy, Check } from "lucide-react";
import * as React from "react";
import { ApiError } from "@/lib/api";
import { companyConfig } from "@/config/company";
import { errorText, fieldText, t } from "@/lib/i18n";
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

  const run = React.useCallback(async (): Promise<T | undefined> => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      return await action();
    } catch (e) {
      if (e instanceof ApiError) {
        const fields = Object.fromEntries(Object.entries(e.fields).map(([k, v]) => [k, fieldText(v) ?? v]));
        setFieldErrors(fields);
        setError(errorText(e.code));
      } else {
        setError(errorText("internal"));
      }
      return undefined;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, [action]);

  return { run, pending, error, fieldErrors, setError };
}

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <Monogram />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{companyConfig.name}</p>
            <p className="text-sm text-muted-foreground">{t("app.tagline")}</p>
          </div>
        </div>
        <Card className="p-5 sm:p-6">
          <h1 className="mb-4 text-xl font-semibold">{title}</h1>
          {children}
        </Card>
      </div>
    </main>
  );
}

export function Monogram({ name = companyConfig.name }: { name?: string }) {
  if (companyConfig.logo) {
    return <img src={companyConfig.logo} alt="" className="size-10 rounded-md object-contain" />;
  }
  const letters = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-semibold text-background">
      {letters || "AM"}
    </span>
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
        aria-label={t("app.copy")}
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
        <span className="sr-only sm:not-sr-only">{copied ? t("app.copied") : t("app.copy")}</span>
      </Button>
    </div>
  );
}

export function LoadError({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <p>{message ?? errorText("network")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("app.retry")}
      </Button>
    </div>
  );
}
