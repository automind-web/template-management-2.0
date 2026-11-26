"use client";

import { BarChart3, Bell, ListTodo, MessageCircle, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCabinet } from "./cabinet-context";
import { HotkeysHelp } from "./hotkeys-help";

type NavItem = { href: string; label: string; short?: string; badge?: number; icon: React.ComponentType<{ className?: string }> };

/** Непрочитанные уведомления: обновляются при переходах и раз в минуту. */
function useUnread(pathname: string) {
  const [unread, setUnread] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ unread: number }>("GET", "/api/notifications/count")
        .then((r) => alive && setUnread(r.unread))
        .catch(() => {});
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [pathname]);
  return unread;
}

function useNav(unread: number) {
  const { me } = useCabinet();
  const main: NavItem[] = [
    { href: "/tasks", label: t("nav.tasks"), icon: ListTodo },
    { href: "/assistant", label: t("nav.assistant"), short: t("nav.assistantShort"), icon: MessageCircle },
    ...(me.capabilities.viewStats ? [{ href: "/stats", label: t("nav.stats"), icon: BarChart3 }] : []),
    { href: "/notifications", label: t("nav.notifications"), icon: Bell, badge: unread },
  ];
  const bottom: NavItem[] = [
    ...(me.capabilities.viewSystemSettings ? [{ href: "/settings", label: t("nav.settings"), icon: Settings }] : []),
    { href: "/profile", label: t("nav.profile"), icon: UserRound },
  ];
  return { main, bottom };
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Знак компании: логотип из настроек или первая буква названия на акцентном фоне. */
export function CompanyMark({ name, logoUrl }: { name: string; logoUrl: string }) {
  if (logoUrl) return <img src={logoUrl} alt="" className="size-9 shrink-0 rounded-md object-contain" />;
  return (
    <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground">
      {name.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

export function CabinetShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { main, bottom } = useNav(useUnread(pathname));
  const { me } = useCabinet();

  return (
    <div className="min-h-dvh md:pl-[232px]">
      {/* ПК: боковая навигация; «Настройки системы» и «Профиль» закреплены внизу. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-16 items-center gap-2.5 px-4">
          <CompanyMark name={me.company.name} logoUrl={me.branding.logoUrl} />
          <span className="min-w-0 truncate text-[15px] font-bold" title={me.company.name}>
            {me.company.name}
          </span>
        </div>
        <nav aria-label={t("nav.main")} className="flex flex-1 flex-col justify-between px-3 pb-3">
          <ul className="flex flex-col gap-1">
            {main.map((item) => (
              <li key={item.href}>
                <SideLink item={item} active={isActive(pathname, item.href)} />
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-1">
            {bottom.map((item) => (
              <li key={item.href}>
                <SideLink item={item} active={isActive(pathname, item.href)} />
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="pb-20 md:pb-0">{children}</div>
      <HotkeysHelp />

      {/* Телефон: нижняя панель с подписями. Настройки — из профиля. */}
      <nav aria-label={t("nav.main")} className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface md:hidden">
        <ul className="flex">
          {[...main, bottom.at(-1)!].map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href) || (item.href === "/profile" && pathname.startsWith("/settings"));
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[10.5px] font-semibold leading-tight tracking-tight",
                    active ? "text-primary" : "text-foreground/60",
                  )}
                >
                  <span className="relative">
                    <Icon className="size-5" />
                    {item.badge ? <Badge n={item.badge} className="absolute -right-2.5 -top-1.5" /> : null}
                  </span>
                  <span className="max-w-full truncate">{item.short ?? item.label}</span>
                </Link>
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
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-semibold leading-tight",
        active ? "bg-selected text-foreground" : "text-foreground/80 hover:bg-muted",
      )}
    >
      <Icon className="size-[18px] shrink-0 text-foreground/70" />
      <span className="flex-1">{item.label}</span>
      {item.badge ? <Badge n={item.badge} /> : null}
    </Link>
  );
}

function Badge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground", className)}>
      <span className="sr-only">{t("notifications.unread")}: </span>
      {n > 99 ? "99+" : n}
    </span>
  );
}
