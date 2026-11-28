"use client";

import { CalendarDays, Check, ChevronDown, Search, UserRound, X } from "lucide-react";
import { Popover } from "radix-ui";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dateInTz } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Assignee } from "./types";

/** Дата «через n дней» от сегодняшней в поясе компании (YYYY-MM-DD). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y!, m! - 1, d! + n));
  return next.toISOString().slice(0, 10);
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** Короткая подпись срока для кнопки: «Сегодня», «Завтра, 18:00», «5 дек.». */
export function dueLabel(date: string, time: string, timeZone: string): string {
  if (!date) return t("tasks.quick.noDue");
  const today = dateInTz(Date.now(), timeZone);
  const day =
    date === today
      ? t("tasks.quick.today")
      : date === addDays(today, 1)
        ? t("tasks.quick.tomorrow")
        : new Intl.DateTimeFormat("ru-RU", {
            day: "numeric",
            month: "short",
            timeZone: "UTC",
          }).format(new Date(`${date}T00:00:00Z`));
  return time ? `${day}, ${time}` : day;
}

/** Кнопка-«пилюля» с всплывающим выбором. */
export const PickerChip = React.forwardRef<HTMLButtonElement, React.ComponentProps<"button"> & { active?: boolean; tone?: "danger" }>(function PickerChip(
  { active, tone, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex h-8 max-w-full shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[13px] font-semibold transition-all active:scale-95",
        active ? "border-transparent bg-selected text-selected-foreground" : "border-border bg-surface text-foreground/75 hover:bg-muted",
        tone === "danger" && "border-transparent bg-danger/10 text-danger",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

function PopoverBody({ children, className, align = "start" }: { children: React.ReactNode; className?: string; align?: "start" | "end" | "center" }) {
  return (
    <Popover.Portal>
      <Popover.Content
        align={align}
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          "card-in z-50 w-72 max-w-[calc(100vw-24px)] rounded-2xl border border-border bg-surface p-2 shadow-[0_18px_50px_-20px_#1d243366]",
          className,
        )}
      >
        {children}
      </Popover.Content>
    </Popover.Portal>
  );
}

/** Выбор исполнителя: аватары, поиск при длинном списке. */
export function AssigneePicker({
  assignees,
  value,
  fallbackName,
  onChange,
  disabled,
  children,
}: {
  assignees: Assignee[] | null;
  value: string;
  fallbackName?: string;
  onChange: (userId: string) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const { me } = useCabinet();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const list = assignees ?? [
    {
      userId: me.user.id,
      displayName: me.user.displayName,
      role: me.role,
      self: true,
    },
  ];
  const current = list.find((a) => a.userId === value);
  const name = current ? (current.self ? t("tasks.quick.me") : current.displayName) : (fallbackName ?? "—");
  const needle = q.trim().toLocaleLowerCase("ru");
  const shown = needle ? list.filter((a) => a.displayName.toLocaleLowerCase("ru").includes(needle)) : list;
  const single = list.length <= 1;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <Popover.Trigger asChild disabled={disabled || single}>
        {children ?? (
          <PickerChip aria-label={`${t("tasks.form.assignee")}: ${name}`} className={cn((disabled || single) && "cursor-default active:scale-100")}>
            {current ? <Avatar name={current.displayName} size={20} /> : <UserRound className="size-3.5" />}
            <span className="max-w-36 truncate">{name}</span>
            {!disabled && !single ? <ChevronDown className="size-3.5 opacity-60" /> : null}
          </PickerChip>
        )}
      </Popover.Trigger>
      <PopoverBody>
        {list.length > 7 ? (
          <label className="relative mb-1.5 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <span className="sr-only">{t("tasks.quick.findPerson")}</span>
            <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tasks.quick.findPerson")} className="h-9 pl-8" />
          </label>
        ) : null}
        <ul className="max-h-72 overflow-y-auto" role="listbox" aria-label={t("tasks.form.assignee")}>
          {shown.map((a) => {
            const selected = a.userId === value;
            return (
              <li key={a.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(a.userId);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                    selected ? "bg-selected/70" : "hover:bg-muted",
                  )}
                >
                  <Avatar name={a.displayName} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{a.self ? t("tasks.quick.me") : a.displayName}</span>
                    {a.self ? <span className="block truncate text-xs text-muted-foreground">{a.displayName}</span> : null}
                  </span>
                  {selected ? <Check className="size-4 text-primary" /> : null}
                </button>
              </li>
            );
          })}
          {shown.length === 0 ? <li className="px-2.5 py-3 text-center text-sm text-muted-foreground">{t("team.empty")}</li> : null}
        </ul>
      </PopoverBody>
    </Popover.Root>
  );
}

/** Выбор срока: «Сегодня / Завтра / Через неделю», своя дата и время, «Без срока». */
export function DuePicker({
  date,
  time,
  onChange,
  overdue,
  disabled,
  label,
}: {
  date: string;
  time: string;
  onChange: (date: string, time: string) => void;
  overdue?: boolean;
  disabled?: boolean;
  label?: string;
}) {
  const { me } = useCabinet();
  const tz = me.company.timezone;
  const [open, setOpen] = React.useState(false);
  const [d, setD] = React.useState(date);
  const [tm, setTm] = React.useState(time);
  React.useEffect(() => {
    if (open) {
      setD(date);
      setTm(time);
    }
  }, [open, date, time]);
  const today = dateInTz(Date.now(), tz);
  const pick = (nd: string, nt = "") => {
    onChange(nd, nt);
    setOpen(false);
  };
  const presets = [
    { key: "today", date: today },
    { key: "tomorrow", date: addDays(today, 1) },
    { key: "week", date: addDays(today, 7) },
  ] as const;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <PickerChip
          active={Boolean(date) && !overdue}
          tone={overdue ? "danger" : undefined}
          aria-label={`${t("tasks.quick.due")}: ${label ?? dueLabel(date, time, tz)}`}
          className={cn(disabled && "cursor-default active:scale-100")}
        >
          <CalendarDays className="size-3.5" />
          {label ?? dueLabel(date, time, tz)}
          {!disabled ? <ChevronDown className="size-3.5 opacity-60" /> : null}
        </PickerChip>
      </Popover.Trigger>
      <PopoverBody className="w-80">
        <div className="grid grid-cols-3 gap-1.5">
          {presets.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pick(p.date, "")}
              className={cn(
                "cursor-pointer rounded-xl border px-2 py-2.5 text-center text-[13px] font-semibold transition-all active:scale-95",
                date === p.date ? "border-primary bg-selected/70 text-selected-foreground" : "border-border hover:bg-muted",
              )}
            >
              {t(`tasks.quick.${p.key}`)}
              <span className="mt-0.5 block text-[11px] font-medium text-muted-foreground">{shortDate(p.date)}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-[1fr_auto] gap-1.5 rounded-xl bg-muted/60 p-2">
          <Input type="date" value={d} onChange={(e) => setD(e.target.value)} aria-label={t("tasks.form.dueDate")} className="h-9 bg-surface" />
          <Input
            type="time"
            value={tm}
            onChange={(e) => setTm(e.target.value)}
            disabled={!d}
            aria-label={t("tasks.form.dueTime")}
            className="h-9 w-24 bg-surface"
          />
          <p className="col-span-2 px-0.5 text-xs text-muted-foreground">{t("tasks.form.dueTimeHint", { time: me.dueTime })}</p>
          <Button size="sm" className="col-span-2" disabled={!d || (d === date && tm === time)} onClick={() => pick(d, tm)}>
            {t("tasks.quick.setDate")}
          </Button>
        </div>
        {date ? (
          <button
            type="button"
            onClick={() => pick("", "")}
            className="mt-1.5 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
            {t("tasks.quick.clearDue")}
          </button>
        ) : null}
      </PopoverBody>
    </Popover.Root>
  );
}
