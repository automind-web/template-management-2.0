"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ALL, useCabinet } from "./cabinet-context";
import { CompanyMark } from "./shell";

/** Шапка страницы — как в шаблоне продаж: заголовок слева, филиал справа (директор меняет его списком). */
export function PageHeader({ title }: { title: string; subtitle?: string }) {
  const { me } = useCabinet();
  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
      <Link href="/tasks" aria-label={me.company.name} className="-ml-0.5 shrink-0 md:hidden">
        <CompanyMark name={me.company.name} logoUrl={me.branding.logoUrl} size={32} className="shadow-sm shadow-primary/25" />
      </Link>
      <h1 className="min-w-0 truncate text-xl font-bold">{title}</h1>
      <div className="ml-auto flex min-w-0 items-center">
        <BranchSwitcher />
      </div>
    </header>
  );
}

export function PageBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <main className={cn("page-in w-full px-4 py-5 sm:px-6", className)}>{children}</main>;
}

/** Выбор филиала: у директора — список, у остальных — название своего филиала. */
function BranchSwitcher() {
  const { me, branchId, setBranchId } = useCabinet();
  if (!me.capabilities.switchBranch) {
    return me.branch?.name ? (
      <span className="max-w-[45vw] truncate text-sm font-semibold text-foreground/75" title={me.branch.name}>
        {me.branch.name}
      </span>
    ) : null;
  }
  if (me.branches.length === 0) return null;
  return (
    <span className="relative inline-flex min-w-0">
      <select
        aria-label={t("branch.choose")}
        className="control-h max-w-[46vw] cursor-pointer appearance-none truncate rounded-lg border border-border bg-surface pl-3.5 pr-9 text-[15px] font-bold disabled:cursor-default sm:max-w-64"
        value={branchId ?? ALL}
        disabled={me.branches.length === 1}
        onChange={(e) => setBranchId(e.target.value)}
      >
        {me.branches.length > 1 ? <option value={ALL}>{t("branch.all")}</option> : null}
        {me.branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" />
    </span>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
      {icon ? (
        <span aria-hidden className="mb-1 inline-flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <p className="font-bold">{title}</p>
      {text ? <p className="max-w-md text-sm text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
