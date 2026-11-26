"use client";

import { BarChart3, Bell, Building2, Check, ChevronDown, ListTodo, MessageCircle, UserRound } from "lucide-react";
import { usePathname } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { Monogram } from "@/components/forms";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCabinet } from "./cabinet-context";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; show: boolean };

function useNav(): { main: NavItem[]; profile: NavItem } {
  const { me } = useCabinet();
  return {
    main: [
      { href: "/tasks", label: t("nav.tasks"), icon: ListTodo, show: true },
      { href: "/assistant", label: t("nav.assistant"), icon: MessageCircle, show: true },
      { href: "/stats", label: t("nav.stats"), icon: BarChart3, show: me.capabilities.viewStats },
      { href: "/notifications", label: t("nav.notifications"), icon: Bell, show: true },
    ].filter((i) => i.show),
    profile: { href: "/profile", label: t("nav.profile"), icon: UserRound, show: true },
  };
}

function isActive(pathname: string, href: string) {
  if (href === "/profile") return pathname === "/profile" || pathname.startsWith("/settings");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CabinetShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { main, profile } = useNav();
  const { me } = useCabinet();

  return (
    <div className="min-h-dvh md:pl-56">
      {/* ПК: компактная боковая навигация, «Профиль» закреплён внизу. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-3">
          <Monogram name={me.company.name} />
          <span className="min-w-0 truncate text-sm font-semibold" title={me.company.name}>
            {me.company.name}
          </span>
        </div>
        <nav aria-label={t("nav.main")} className="flex flex-1 flex-col justify-between p-2">
          <ul className="flex flex-col gap-1">
            {main.map((item) => (
              <li key={item.href}>
                <SideLink item={item} active={isActive(pathname, item.href)} />
              </li>
            ))}
          </ul>
          <SideLink item={profile} active={isActive(pathname, profile.href)} />
        </nav>
      </aside>

      <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur">
        <span className="md:hidden">
          <Monogram name={me.company.name} />
        </span>
        <BranchSwitcher />
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 md:pb-8">{children}</main>

      {/* Телефон: нижняя панель с подписями. */}
      <nav aria-label={t("nav.main")} className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface md:hidden">
        <ul className="flex">
          {[...main, profile].map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <a
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" />
                  <span className="max-w-full truncate">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <a
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-md px-3 text-sm",
        active ? "bg-selected font-medium text-primary" : "text-foreground hover:bg-muted",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </a>
  );
}

/** Директор видит текущий филиал и меняет его нажатием. Остальные — только название своего. */
function BranchSwitcher() {
  const { me, branchId, setBranchId } = useCabinet();
  const current = me.branches.find((b) => b.id === branchId);

  if (!me.capabilities.switchBranch || me.branches.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">{t("branch.current")}:</span>
        <span className="truncate font-medium">{current?.name ?? t("branch.none")}</span>
      </div>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex min-w-0 max-w-[70vw] items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted md:max-w-sm"
        aria-label={`${t("branch.choose")}: ${current?.name ?? ""}`}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{current?.name ?? t("branch.choose")}</span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-[60vh] min-w-56 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">{t("branch.choose")}</DropdownMenu.Label>
          {me.branches.map((b) => (
            <DropdownMenu.Item
              key={b.id}
              onSelect={() => setBranchId(b.id)}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[highlighted]:bg-muted"
            >
              <Check className={cn("size-4", b.id === branchId ? "opacity-100" : "opacity-0")} aria-hidden />
              <span className="break-words">{b.name}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
