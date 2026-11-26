import { formatShortDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { StatusRef, TransitionInfo } from "./types";

const STATUS_TONE: Record<string, string> = {
  open: "bg-[#eef0f3] text-[#4b5563] [--dot:#6b7280]",
  progress: "bg-selected text-primary [--dot:var(--am-accent)]",
  review: "bg-[#fdf1dc] text-[#9a5b00] [--dot:#d48a1a]",
  done: "bg-[#e3f5ea] text-[#1f8a46] [--dot:#1f8a46]",
  cancelled: "bg-[#f3f4f6] text-[#6b7280] [--dot:#9ca3af]",
};

/** Статус: точка + подпись (различим не только по цвету). */
export function StatusPill({ status, cancelledName, className }: { status: StatusRef; cancelledName?: string | null; className?: string }) {
  const tone = cancelledName ? "cancelled" : status.category;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold leading-none",
        STATUS_TONE[tone] ?? STATUS_TONE.open,
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--dot)]" />
      {cancelledName ?? status.name}
    </span>
  );
}

/** Срок: «Просрочено · 23 нояб., 23:59», «Срок · 25 нояб., 23:59» или «Без срока». */
export function DueText({ dueAt, overdue, timeZone, className }: { dueAt: number | null; overdue: boolean; timeZone: string; className?: string }) {
  if (!dueAt) return <span className={cn("text-sm text-muted-foreground", className)}>{t("tasks.due.none")}</span>;
  const when = formatShortDateTime(dueAt, timeZone);
  return overdue ? (
    <span className={cn("text-sm font-semibold text-destructive", className)}>{t("tasks.due.overdue", { date: when })}</span>
  ) : (
    <span className={cn("text-sm text-muted-foreground", className)}>{t("tasks.due.until", { date: when })}</span>
  );
}

export function transitionLabel(tr: TransitionInfo, fromCategory?: string): string {
  if (tr.kind === "status_changed" && fromCategory === "open") return t("tasks.actions.start");
  if (tr.kind === "status_changed") return t("tasks.actions.status_changed", { status: tr.toName });
  return t(`tasks.actions.${tr.kind}`);
}
