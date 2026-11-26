import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card" className={cn("rounded-xl border border-border bg-surface shadow-[0_1px_3px_rgba(16,24,40,0.05)]", className)} {...props} />
  );
}

/** Карточка-раздел с заголовком (профиль, настройки, уведомления). */
export function Section({
  title,
  description,
  icon,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-selected text-primary">{icon}</span> : null}
            <div className="min-w-0">
              {title ? <h2 className="text-lg font-bold">{title}</h2> : null}
              {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          {actions}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

/** Состояние подключения или канала: точка + подпись (различимо не только по цвету). */
export function StateDot({ ok, children, className }: { ok: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", ok ? "text-success" : "text-destructive", className)}>
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", ok ? "bg-success" : "bg-destructive")} />
      {children}
    </span>
  );
}

export function Alert({
  className,
  tone = "neutral",
  ...props
}: React.ComponentProps<"div"> & { tone?: "neutral" | "danger" | "success" }) {
  const tones = {
    neutral: "border-border bg-muted text-foreground",
    danger: "border-destructive/30 bg-destructive/5 text-destructive",
    success: "border-success/30 bg-success/5 text-success",
  };
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm", tones[tone], className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

/** Подпись-значение (профиль, карточка задачи). */
export function Meta({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}
