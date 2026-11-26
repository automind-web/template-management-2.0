"use client";

import { BarChart3, Bell, ListTodo, MessageCircle, Settings, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { Avatar } from "@/components/ui/avatar";
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
    { href: "/notifications", label: t("nav.notifications"), short: t("nav.notificationsShort"), icon: Bell, badge: unread },
  ];
  const extra: NavItem[] = me.capabilities.viewSystemSettings
    ? [{ href: "/settings", label: t("nav.settings"), icon: Settings }]
    : me.capabilities.manageTeam
      ? [{ href: "/settings", label: t("nav.team"), icon: Users }]
      : [];
  return { main, extra, profile: { href: "/profile", label: t("nav.profile"), icon: UserRound } as NavItem };
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Знак компании: логотип из настроек или первая буква названия на акцентном фоне. */
export function CompanyMark({ name, logoUrl, size = 36 }: { name: string; logoUrl: string; size?: number }) {
  if (logoUrl) return <img src={logoUrl} alt="" style={{ width: size, height: size }} className="shrink-0 rounded-lg object-contain" />;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-base font-bold text-primary-foreground shadow-sm"
    >
      {name.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

export function CabinetShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { main, extra, profile } = useNav(useUnread(pathname));
  const { me } = useCabinet();

  return (
    <div className="min-h-dvh md:pl-[248px]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-16 items-center gap-3 px-4">
          <CompanyMark name={me.company.name} logoUrl={me.branding.logoUrl} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-bold" title={me.company.name}>
              {me.company.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{t("app.tagline")}</span>
          </span>
        </div>
        <nav aria-label={t("nav.main")} className="flex flex-1 flex-col justify-between px-3 pb-3 pt-2">
          <ul className="flex flex-col gap-1">
            {[...main, ...extra].map((item) => (
              <li key={item.href}>
                <SideLink item={item} active={isActive(pathname, item.href)} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <SystemStatus />
            <Link
              href={profile.href}
              aria-current={isActive(pathname, profile.href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                isActive(pathname, profile.href) ? "border-primary/30 bg-selected" : "border-border hover:bg-muted",
              )}
            >
              <Avatar name={me.user.displayName} size={34} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{me.user.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">{t(`roles.${me.role}`)}</span>
              </span>
            </Link>
          </div>
        </nav>
      </aside>

      <div className="pb-20 md:pb-0">{children}</div>
      <HotkeysHelp />

      {/* Телефон: нижняя панель с подписями. Настройки — из профиля. */}
      <nav aria-label={t("nav.main")} className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:hidden">
        <ul className="flex">
          {[...main, profile].map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item.href) || (item.href === "/profile" && pathname.startsWith("/settings"));
            return (
              <li key={item.href} className="min-w-0 flex-1">
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[10.5px] font-semibold leading-tight", active ? "text-primary" : "text-foreground/55")}
                >
                  <span className={cn("relative flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-selected")}>
                    <Icon className="size-5" />
                    {item.badge ? <Badge n={item.badge} className="absolute -right-1 -top-1" /> : null}
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

/** Состояние системы: помощник и WhatsApp (директору — со ссылкой на настройку). */
function SystemStatus() {
  const { me } = useCabinet();
  const rows = [
    { ok: me.system.smartAssistant, label: me.system.smartAssistant ? t("system.smartOn") : t("system.smartOff") },
    { ok: me.system.whatsapp, label: me.system.whatsapp ? t("system.waOn") : t("system.waOff") },
  ];
  const body = (
    <span className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <span key={r.label} className="flex items-center gap-2 text-xs font-medium text-foreground/75">
          <span className={cn("size-2 shrink-0 rounded-full", r.ok ? "bg-success shadow-[0_0_0_3px] shadow-success/15" : "bg-[#c4c9d2]")} />
          {r.label}
        </span>
      ))}
    </span>
  );
  return me.capabilities.viewSystemSettings ? (
    <Link href="/settings?tab=assistant" className="rounded-xl bg-muted/70 px-3 py-2.5 hover:bg-muted" title={t("system.configure")}>
      {body}
    </Link>
  ) : (
    <div className="rounded-xl bg-muted/70 px-3 py-2.5">{body}</div>
  );
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-semibold leading-tight transition-colors",
        active ? "bg-selected text-primary" : "text-foreground/75 hover:bg-muted hover:text-foreground",
      )}
    >
      {active ? <span aria-hidden className="absolute -left-3 top-2 h-6 w-1 rounded-r-full bg-primary" /> : null}
      <Icon className="size-[18px] shrink-0" />
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
