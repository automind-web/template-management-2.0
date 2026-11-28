import { formatShortDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { StatusRef, TransitionInfo } from "./types";

/** Тона статусов — как у пилюль шаблона продаж 2.0. */
const STATUS_TONE: Record<string, string> = {
  open: "bg-[#eef0f4] text-[#4b5263]",
  progress: "bg-selected text-primary",
  review: "bg-[#fdf0dc] text-warning",
  done: "bg-[#e2f3e9] text-success",
  cancelled: "bg-[#eef0f4] text-[#4b5263] opacity-80",
};

/** Статус: точка + подпись (различим не только по цвету). */
export function StatusPill({ status, cancelledName, className }: { status: StatusRef; cancelledName?: string | null; className?: string }) {
  const tone = cancelledName ? "cancelled" : status.category;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-semibold",
        STATUS_TONE[tone] ?? STATUS_TONE.open,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {cancelledName ?? status.name}
    </span>
  );
}

/** Срок: «Просрочено · 23 нояб., 23:59», «Срок · 25 нояб., 23:59» или «Без срока». */
export function DueText({ dueAt, overdue, timeZone, className }: { dueAt: number | null; overdue: boolean; timeZone: string; className?: string }) {
  if (!dueAt) return <span className={cn("text-sm text-muted-foreground", className)}>{t("tasks.due.none")}</span>;
  const when = formatShortDateTime(dueAt, timeZone);
  return overdue ? (
    <span className={cn("text-sm font-semibold text-danger", className)}>{t("tasks.due.overdue", { date: when })}</span>
  ) : (
    <span className={cn("text-sm text-muted-foreground", className)}>{t("tasks.due.until", { date: when })}</span>
  );
}

export function transitionLabel(tr: TransitionInfo, fromCategory?: string): string {
  if (tr.kind === "status_changed" && fromCategory === "open") return t("tasks.actions.start");
  if (tr.kind === "status_changed") return t("tasks.actions.status_changed", { status: tr.toName });
  return t(`tasks.actions.${tr.kind}`);
}
