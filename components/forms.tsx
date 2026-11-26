"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";
import { ApiError } from "@/lib/api";
import { errorText, fieldText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

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

/** Страницы без входа: на ПК — описание продукта слева и форма справа; на телефоне — только форма. */
export function AuthShell({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  const [brand, setBrand] = React.useState<{ name: string; logoUrl: string } | null>(null);
  React.useEffect(() => {
    fetch("/api/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setBrand(b))
      .catch(() => {});
  }, []);
  const name = brand?.name ?? "";
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-[#1b2f86] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-2xl" />
        <div aria-hidden className="absolute -bottom-32 -left-16 size-96 rounded-full bg-white/5" />
        <div className="relative flex items-center gap-3">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt="" className="size-11 rounded-xl bg-white object-contain p-1" />
          ) : (
            <span className="flex size-11 items-center justify-center rounded-xl bg-white/15 text-lg font-bold">{name.charAt(0) || "A"}</span>
          )}
          <span className="text-lg font-bold">{name}</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">{t("auth.heroTitle")}</h2>
          <ul className="mt-8 flex flex-col gap-4 text-[15px] text-white/90">
            {(["f1", "f2", "f3"] as const).map((k) => (
              <li key={k} className="flex items-start gap-3">
                <Check className="mt-0.5 size-5 shrink-0 rounded-full bg-white/20 p-0.5" />
                {t(`auth.${k}`)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/60">{t("auth.footer")}</p>
      </section>
      <section className="flex items-center justify-center px-4 py-10">
        <div className="am-fade-up w-full max-w-[400px]">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-base font-bold text-primary-foreground">{name.charAt(0) || "A"}</span>
            <span className="font-bold">{name}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{description}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </section>
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
