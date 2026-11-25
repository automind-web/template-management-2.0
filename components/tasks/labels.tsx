import { AlertTriangle, CalendarClock, CalendarX } from "lucide-react";
import { Badge } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { StatusRef, TransitionInfo } from "./types";

/** Статус различим по подписи, цвет — дополнительный признак. */
export function StatusBadge({ status, cancelled, className }: { status: StatusRef; cancelled?: boolean; className?: string }) {
  if (cancelled) {
    return (
      <Badge tone="neutral" className={cn("line-through", className)}>
        {t("tasks.cancelledBadge")}
      </Badge>
    );
  }
  const tone =
    status.category === "done" ? "success" : status.category === "review" ? "warning" : status.category === "progress" ? "accent" : "neutral";
  return (
    <Badge tone={tone} className={className}>
      {status.name}
    </Badge>
  );
}

export function formatDueDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y}`;
}

/** Срок: текст «Просрочено», «Срок: сегодня», «Без срока» — не только цвет. */
export function DueLabel({
  dueDate,
  overdue,
  today,
  className,
}: {
  dueDate: string | null;
  overdue: boolean;
  today?: string;
  className?: string;
}) {
  if (!dueDate) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
        <CalendarX className="size-3.5" aria-hidden />
        {t("tasks.due.none")}
      </span>
    );
  }
  if (overdue) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-medium text-destructive", className)}>
        <AlertTriangle className="size-3.5" aria-hidden />
        {t("tasks.due.overdue", { date: formatDueDate(dueDate) })}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <CalendarClock className="size-3.5" aria-hidden />
      {today && dueDate === today ? t("tasks.due.today") : t("tasks.due.until", { date: formatDueDate(dueDate) })}
    </span>
  );
}

export function transitionLabel(tr: TransitionInfo, fromCategory?: string): string {
  if (tr.kind === "status_changed" && fromCategory === "open") return t("tasks.actions.start");
  if (tr.kind === "status_changed") return t("tasks.actions.status_changed", { status: tr.toName });
  return t(`tasks.actions.${tr.kind}`);
}
