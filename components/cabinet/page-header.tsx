"use client";

import { Check, ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ALL, useCabinet } from "./cabinet-context";

/** Шапка страницы: название слева, филиал справа (директор меняет его нажатием). */
export function PageHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
      <h1 className="min-w-0 truncate text-xl font-bold">{title}</h1>
      <BranchSwitcher />
    </header>
  );
}

export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <main className={cn("px-4 py-5 sm:px-6", className)}>{children}</main>;
}

function BranchSwitcher() {
  const { me, branchId, setBranchId } = useCabinet();
  const label = branchId === ALL ? t("branch.all") : (me.branches.find((b) => b.id === branchId)?.name ?? t("branch.none"));

  if (!me.capabilities.switchBranch || me.branches.length <= 1) {
    return (
      <span className="min-w-0 truncate text-[15px] font-semibold text-foreground/70">
        <span className="sr-only">{t("branch.current")}: </span>
        {label}
      </span>
    );
  }

  const options = [{ id: ALL, name: t("branch.all") }, ...me.branches];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex min-w-0 max-w-[55vw] items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2 text-[15px] font-semibold shadow-sm hover:bg-muted sm:max-w-xs"
        aria-label={`${t("branch.choose")}: ${label}`}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-foreground/60" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 max-h-[60vh] min-w-56 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg">
          {options.map((b) => (
            <DropdownMenu.Item
              key={b.id}
              onSelect={() => setBranchId(b.id)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[15px] outline-none data-[highlighted]:bg-muted"
            >
              <Check className={cn("size-4 shrink-0 text-primary", b.id === branchId ? "opacity-100" : "opacity-0")} aria-hidden />
              <span className="break-words">{b.name}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-14 text-center">
      {icon ? <div className="mb-1 flex size-12 items-center justify-center rounded-xl bg-muted text-foreground/60">{icon}</div> : null}
      <h2 className="text-base font-semibold">{title}</h2>
      {text ? <p className="max-w-md text-sm text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
