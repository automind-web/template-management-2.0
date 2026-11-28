"use client";

import { BarChart3, Bell, Check, Copy, ListTodo, MessageCircle } from "lucide-react";
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

const MODULES = [
  { icon: ListTodo, label: "nav.tasks" },
  { icon: MessageCircle, label: "nav.assistant" },
  { icon: BarChart3, label: "nav.stats" },
  { icon: Bell, label: "nav.notifications" },
] as const;

/** Страницы без входа — как в шаблоне продаж: фирменная панель слева и форма в карточке справа. */
export function AuthShell({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  const [brand, setBrand] = React.useState<{ name: string; logoUrl: string } | null>(null);
  React.useEffect(() => {
    fetch("/api/branding")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => b && setBrand(b))
      .catch(() => {});
  }, []);
  const name = brand?.name ?? "";
  const letter = (name.trim()[0] ?? "A").toUpperCase();
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(80%_60%_at_0%_0%,#ffffff2e,transparent_60%),radial-gradient(70%_60%_at_100%_100%,#00000033,transparent_60%)]" />
        <div aria-hidden className="absolute -bottom-24 -right-24 size-96 rounded-full border border-white/15" />
        <div aria-hidden className="absolute -bottom-8 -right-8 size-64 rounded-full border border-white/10" />
        <div className="relative flex items-center gap-3">
          {brand?.logoUrl ? (
            <img src={brand.logoUrl} alt="" className="size-11 rounded-2xl bg-white object-contain p-1" />
          ) : (
            <span className="grid size-11 place-items-center rounded-2xl bg-white/15 text-lg font-bold backdrop-blur">{letter}</span>
          )}
          <span className="text-lg font-bold">{name}</span>
        </div>
        <div className="relative grid max-w-md gap-6">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">{t("auth.heroTitle")}</h2>
          <p className="text-lg text-white/80">{t("auth.heroText")}</p>
          <ul className="flex flex-wrap gap-2">
            {MODULES.map(({ icon: Icon, label }, index) => (
              <li key={label} className="rise-in inline-flex items-center gap-2 rounded-full bg-white/12 px-3.5 py-2 text-sm font-semibold backdrop-blur" style={{ "--i": index + 1 } as React.CSSProperties}>
                <Icon className="size-4" />
                {t(label)}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/60">{t("auth.footer")}</p>
      </aside>
      <div className="flex items-start justify-center px-4 py-10 sm:items-center">
        <div className="page-in w-full max-w-md">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-base font-bold text-primary-foreground shadow-md shadow-primary/25">{letter}</span>
            <span className="font-bold">{name}</span>
          </div>
          <Card className="w-full p-7">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description ? <div className="mt-2 text-sm leading-relaxed text-muted-foreground break-anywhere">{description}</div> : null}
            <div className="mt-5">{children}</div>
          </Card>
        </div>
      </div>
    </main>
  );
}

export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} className={cn("text-sm font-medium text-primary hover:underline", className)}>
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
        className="control-h min-w-0 flex-1 rounded-lg border border-input bg-muted px-3 font-mono text-xs"
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
    <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl bg-[#fde7e6] p-4 text-sm text-danger">
      <p>{message ?? errorText("network")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("app.retry")}
      </Button>
    </div>
  );
}
