import * as React from "react";
import { cn } from "@/lib/utils";

/** Карточка — как в шаблоне продаж 2.0: скругление 16px, тонкая рамка и мягкая тень. */
export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("rounded-2xl border border-border bg-surface shadow-[0_1px_2px_#1d24330a,0_10px_30px_-20px_#1d243333]", className)} {...props} />;
}

/** Карточка-раздел: значок, заголовок, пояснение, действие справа и содержимое. */
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
    <Card className={cn("p-5", className)}>
      {title || actions ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {icon ? (
              <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary [&_svg]:size-5">
                {icon}
              </span>
            ) : null}
            <div className="min-w-0">
              {title ? <h2 className="text-[17px] font-bold break-anywhere">{title}</h2> : null}
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

/** Состояние подключения: «● Работает», «● Не подключён» (различимо не только по цвету). */
export function StateDot({ ok, children, className }: { ok: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm font-semibold", ok ? "text-success" : "text-danger", className)}>
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />
      <span className="break-anywhere">{children}</span>
    </span>
  );
}

/** Сообщение формы: ошибка, успех или пояснение. */
export function Alert({ className, tone = "neutral", ...props }: React.ComponentProps<"div"> & { tone?: "neutral" | "danger" | "success" }) {
  const tones = {
    neutral: "bg-[#fff6dd] text-[#6b5310]",
    danger: "bg-[#fde7e6] text-danger",
    success: "bg-[#e2f3e9] text-success",
  };
  return <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-lg px-3.5 py-2.5 text-sm break-anywhere", tones[tone], className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current/30 border-t-current", className)} />;
}

/** Подпись капсом и значение (профиль, карточка задачи). */
export function Meta({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[15px] break-anywhere">{children}</dd>
    </div>
  );
}
