"use client";

import { BarChart3, Bell, Ellipsis, ListTodo, MessageCircle, PanelLeftClose, PanelLeftOpen, Settings, UserRound, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { isMac } from "@/lib/hotkeys";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useCabinet } from "./cabinet-context";
import { HotkeysHelp } from "./hotkeys-help";

type NavItem = {
  key: string;
  href: string;
  label: string;
  short?: string;
  icon: LucideIcon;
};

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
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const message = (event: MessageEvent) => { if (event.data?.type === "notification") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("am:notifications", refresh);
    document.addEventListener("visibilitychange", refresh);
    navigator.serviceWorker?.addEventListener("message", message);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("am:notifications", refresh);
      document.removeEventListener("visibilitychange", refresh);
      navigator.serviceWorker?.removeEventListener("message", message);
    };
  }, [pathname]);
  return unread;
}

/** Число непрочитанных — один запрос на весь кабинет (боковое меню и нижняя панель берут его отсюда). */
const UnreadCtx = React.createContext(0);

/** Общие данные меню для боковой и нижней панели. */
function useNav() {
  const { me } = useCabinet();
  const pathname = usePathname() ?? "/";
  const unread = React.useContext(UnreadCtx);
  const main: NavItem[] = [
    { key: "tasks", href: "/tasks", label: t("nav.tasks"), icon: ListTodo },
    {
      key: "assistant",
      href: "/assistant",
      label: t("nav.assistant"),
      short: t("nav.assistantShort"),
      icon: MessageCircle,
    },
    ...(me.capabilities.viewStats
      ? [
          {
            key: "stats",
            href: "/stats",
            label: t("nav.stats"),
            icon: BarChart3,
          },
        ]
      : []),
    {
      key: "notifications",
      href: "/notifications",
      label: t("nav.notifications"),
      short: t("nav.notificationsShort"),
      icon: Bell,
    },
  ];
  const settings: NavItem | null = me.capabilities.viewSystemSettings
    ? {
        key: "settings",
        href: "/settings",
        label: t("nav.settings"),
        icon: Settings,
      }
    : me.capabilities.manageTeam
      ? {
          key: "settings",
          href: "/settings",
          label: t("nav.team"),
          icon: Users,
        }
      : null;
  const profile: NavItem = {
    key: "profile",
    href: "/profile",
    label: t("nav.profile"),
    icon: UserRound,
  };
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  return { me, main, settings, profile, isActive, unread, pathname };
}
type Nav = ReturnType<typeof useNav>;

/** Отметка у пункта: число непрочитанных у уведомлений, точка работы WhatsApp у помощника. */
function NavBadge({ item, nav, compact = false }: { item: NavItem; nav: Nav; compact?: boolean }) {
  if (item.key === "notifications" && nav.unread > 0) {
    const label = `${t("notifications.unread")}: ${nav.unread}`;
    return (
      <span
        title={label}
        className={cn(
          "min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-bold leading-5 text-white tabular-nums",
          compact
            ? "absolute -top-1.5 left-[calc(50%+4px)] min-w-[18px] px-1 text-[10px] leading-[18px] ring-2 ring-surface"
            : "nav-collapsed:absolute nav-collapsed:right-1.5 nav-collapsed:top-1 nav-collapsed:min-w-[18px] nav-collapsed:px-1 nav-collapsed:text-[10px] nav-collapsed:leading-[18px] nav-collapsed:ring-2 nav-collapsed:ring-background",
        )}
      >
        {nav.unread > 99 ? "99+" : nav.unread}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  if (item.key === "assistant") {
    const on = nav.me.system.whatsapp;
    const label = on ? t("system.waOn") : t("system.waOff");
    return (
      <span
        title={label}
        className={cn(
          "size-2 rounded-full",
          on ? "live-dot bg-success" : "bg-foreground/25",
          compact
            ? "absolute left-[calc(50%+8px)] top-0 ring-2 ring-surface"
            : "nav-collapsed:absolute nav-collapsed:right-3 nav-collapsed:top-2 nav-collapsed:ring-2 nav-collapsed:ring-background",
        )}
      >
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return null;
}

/** Знак компании: логотип из настроек или первая буква названия на фирменном цвете. */
export function CompanyMark({ name, logoUrl, size = 36, className }: { name: string; logoUrl: string; size?: number; className?: string }) {
  if (logoUrl) return <img src={logoUrl} alt="" style={{ width: size, height: size }} className={cn("shrink-0 rounded-lg object-contain", className)} />;
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground", className)}
    >
      {name.trim().charAt(0).toUpperCase() || "A"}
    </span>
  );
}

// --- Подсказка с названием пункта в свёрнутом меню ---

type Tip = { text: string; top: number; left: number } | null;
const collapsedNow = () => typeof document !== "undefined" && document.documentElement.dataset.nav === "collapsed";

function useTip() {
  const [tip, setTip] = React.useState<Tip>(null);
  const show = React.useCallback((el: HTMLElement, text: string) => {
    if (!collapsedNow()) return;
    const rect = el.getBoundingClientRect();
    setTip({ text, top: rect.top + rect.height / 2, left: rect.right + 10 });
  }, []);
  const hide = React.useCallback(() => setTip(null), []);
  const bind = (text: string) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget, text),
    onMouseLeave: hide,
    onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget, text),
    onBlur: hide,
  });
  const node =
    tip && typeof document !== "undefined"
      ? createPortal(
          <div
            role="tooltip"
            style={{ top: tip.top, left: tip.left }}
            className="pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg bg-foreground px-2.5 py-1.5 text-[13px] font-semibold text-background shadow-lg"
          >
            {tip.text}
          </div>,
          document.body,
        )
      : null;
  return { bind, hide, node };
}

function SideLink({ item, nav, tip }: { item: NavItem; nav: Nav; tip: ReturnType<typeof useTip> }) {
  const Icon = item.icon;
  const active = nav.isActive(item.href);
  return (
    <Link
      href={item.href}
      onClick={tip.hide}
      {...tip.bind(item.label)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition-all duration-150 nav-collapsed:justify-center nav-collapsed:px-0",
        active
          ? "bg-surface text-foreground shadow-[0_1px_2px_#1d24330f,0_4px_14px_-8px_#1d243326]"
          : "text-foreground/75 hover:bg-muted hover:text-foreground",
      )}
    >
      {active ? <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-primary" /> : null}
      <Icon
        aria-hidden
        className={cn("size-[19px] shrink-0 transition-colors", active ? "text-primary" : "text-foreground/55 group-hover:text-foreground/80")}
        strokeWidth={1.75}
      />
      <span className="flex-1 break-anywhere nav-collapsed:sr-only">{item.label}</span>
      <NavBadge item={item} nav={nav} />
    </Link>
  );
}

/** Боковое меню на ПК; сворачивается до значков кнопкой или Ctrl+B (⌘+B). */
function Sidebar({ collapsed, toggle }: { collapsed: boolean; toggle: () => void }) {
  const nav = useNav();
  const { me } = nav;
  const tip = useTip();
  const profileActive = nav.isActive("/profile");
  const [keys, setKeys] = React.useState("Ctrl+B");
  React.useEffect(() => setKeys(isMac() ? "⌘+B" : "Ctrl+B"), []);
  const toggleLabel = `${collapsed ? t("nav.expand") : t("nav.collapse")} (${keys})`;
  return (
    <div className="flex h-full flex-col gap-4 p-3 nav-collapsed:px-2.5">
      <div className="flex items-center gap-2 px-1 pt-1 nav-collapsed:flex-col nav-collapsed:px-0">
        <Link href="/tasks" {...tip.bind(me.company.name)} onClick={tip.hide} className="flex min-w-0 flex-1 items-center gap-2.5 nav-collapsed:flex-none">
          <CompanyMark name={me.company.name} logoUrl={me.branding.logoUrl} className="shadow-md shadow-primary/25" />
          <span className="truncate text-[15px] font-bold nav-collapsed:sr-only" title={me.company.name}>
            {me.company.name}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => {
            tip.hide();
            toggle();
          }}
          {...tip.bind(toggleLabel)}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
          aria-expanded={!collapsed}
          aria-controls="side-nav"
          title={collapsed ? undefined : toggleLabel}
          className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground/55 transition-colors hover:bg-muted hover:text-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen aria-hidden className="size-[19px]" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose aria-hidden className="size-[19px]" strokeWidth={1.75} />
          )}
        </button>
      </div>
      <nav id="side-nav" aria-label={t("nav.main")} className="flex min-h-0 flex-1 flex-col justify-between gap-4 overflow-y-auto overflow-x-hidden">
        <ul className="grid gap-1">
          {nav.main.map((item) => (
            <li key={item.href}>
              <SideLink item={item} nav={nav} tip={tip} />
            </li>
          ))}
        </ul>
        <ul className="grid gap-1">
          {nav.settings ? (
            <li>
              <SideLink item={nav.settings} nav={nav} tip={tip} />
            </li>
          ) : null}
          <li>
            <Link
              href="/profile"
              onClick={tip.hide}
              {...tip.bind(`${t("nav.profile")}: ${me.user.displayName}`)}
              aria-current={profileActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-2.5 transition-all nav-collapsed:justify-center nav-collapsed:p-1.5",
                profileActive ? "border-primary/30 bg-surface shadow-sm" : "border-transparent hover:bg-muted",
              )}
            >
              <Avatar name={me.user.displayName} size={36} />
              <span className="min-w-0 nav-collapsed:sr-only">
                <span className="block truncate text-sm font-semibold">{me.user.displayName}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t(`roles.${me.role}`)}
                  {me.branch?.name && me.role !== "director" ? ` · ${me.branch.name}` : ""}
                </span>
              </span>
              <span className="sr-only">{t("nav.profile")}</span>
            </Link>
          </li>
        </ul>
      </nav>
      {tip.node}
    </div>
  );
}

/** Вкладка нижней панели: значок в «таблетке» и короткая подпись. */
function TabButton({
  icon: Icon,
  label,
  active,
  badge,
  href,
  onClick,
  expanded,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const body = (
    <>
      <span
        className={cn(
          "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200",
          active ? "bg-primary/12 text-primary" : "text-foreground/60",
        )}
      >
        <Icon aria-hidden className="size-[22px]" strokeWidth={active ? 2.1 : 1.8} />
        {badge}
      </span>
      <span className={cn("max-w-full truncate px-0.5 text-[11px] leading-4", active ? "font-bold text-primary" : "font-semibold text-foreground/70")}>
        {label}
      </span>
    </>
  );
  const cls = "flex min-w-0 flex-1 select-none flex-col items-center justify-center gap-0.5 pb-1.5 pt-2 transition-transform active:scale-95";
  if (href) {
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" aria-expanded={expanded} className={cn(cls, "cursor-pointer")}>
      {body}
    </button>
  );
}

const MAX_TABS = 5;

/** Нижняя панель на телефоне: до 5 вкладок; если разделов больше — 4 вкладки и «Ещё». */
function TabBar() {
  const nav = useNav();
  const { me } = nav;
  const [openedAt, setOpenedAt] = React.useState<string | null>(null);
  const moreOpen = openedAt === nav.pathname;
  const all = [...nav.main, ...(nav.settings ? [nav.settings] : []), nav.profile];
  const tabs = all.length <= MAX_TABS ? all : all.slice(0, MAX_TABS - 1);
  const rest = all.length <= MAX_TABS ? [] : all.slice(MAX_TABS - 1);
  const moreActive = rest.some((item) => nav.isActive(item.href));

  return (
    <>
      <nav
        aria-label={t("nav.main")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_-12px_#1d243340] backdrop-blur-md md:hidden"
      >
        <div className="mx-auto flex h-16 max-w-xl items-stretch px-1">
          {tabs.map((item) => (
            <TabButton
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.short ?? item.label}
              active={nav.isActive(item.href)}
              badge={<NavBadge item={item} nav={nav} compact />}
            />
          ))}
          {rest.length ? (
            <TabButton icon={Ellipsis} label={t("nav.more")} active={moreActive || moreOpen} expanded={moreOpen} onClick={() => setOpenedAt(nav.pathname)} />
          ) : null}
        </div>
      </nav>
      <Dialog open={moreOpen} onOpenChange={(o) => !o && setOpenedAt(null)}>
        <DialogContent title={t("nav.moreTitle")}>
          <div className="grid gap-4 pb-[env(safe-area-inset-bottom)]">
            {rest.some((item) => item.key === "profile") ? (
              <Link
                href="/profile"
                onClick={() => setOpenedAt(null)}
                aria-current={nav.isActive("/profile") ? "page" : undefined}
                className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3 active:bg-muted"
              >
                <Avatar name={me.user.displayName} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{me.user.displayName}</span>
                  <span className="block truncate text-[13px] text-muted-foreground">{t(`roles.${me.role}`)}</span>
                </span>
                <span className="text-[13px] font-semibold text-primary">{t("nav.profile")}</span>
              </Link>
            ) : null}
            <ul className="grid grid-cols-2 gap-2.5">
              {rest
                .filter((item) => item.key !== "profile")
                .map((item) => {
                  const Icon = item.icon;
                  const active = nav.isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpenedAt(null)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-[92px] flex-col justify-between gap-3 rounded-2xl border p-3.5",
                          active ? "border-primary/40 bg-primary/5" : "border-border bg-background active:bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "relative grid size-10 place-items-center rounded-xl",
                            active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
                          )}
                        >
                          <Icon aria-hidden className="size-5" strokeWidth={1.9} />
                          <NavBadge item={item} nav={nav} compact />
                        </span>
                        <span className="text-[14px] font-semibold leading-tight break-anywhere">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const NAV_KEY = "am-nav";
const navListeners = new Set<() => void>();
function subscribeNav(listener: () => void) {
  navListeners.add(listener);
  return () => {
    navListeners.delete(listener);
  };
}

export function CabinetShell({ children }: { children: React.ReactNode }) {
  const unread = useUnread(usePathname() ?? "/");
  // Состояние уже выставлено на <html> скриптом до отрисовки; React читает его оттуда.
  const collapsed = React.useSyncExternalStore(subscribeNav, collapsedNow, () => false);

  const toggleNav = React.useCallback(() => {
    const next = !collapsedNow();
    if (next) document.documentElement.dataset.nav = "collapsed";
    else delete document.documentElement.dataset.nav;
    try {
      localStorage.setItem(NAV_KEY, next ? "collapsed" : "open");
    } catch {
      /* хранилище недоступно — состояние живёт до перезагрузки */
    }
    navListeners.forEach((listener) => listener());
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "b" || !(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || document.querySelector("[role=dialog]")) return;
      if (!window.matchMedia("(min-width: 768px)").matches) return;
      e.preventDefault();
      toggleNav();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [toggleNav]);

  return (
    <UnreadCtx.Provider value={unread}>
      <div className="flex min-h-screen">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
        >
          {t("nav.skipToContent")}
        </a>
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-border bg-background transition-[width] duration-200 ease-out motion-reduce:transition-none md:block nav-collapsed:w-[76px]">
          <Sidebar collapsed={collapsed} toggle={toggleNav} />
        </aside>
        <div id="content" className="flex min-w-0 flex-1 flex-col pb-[var(--tabbar-h)] md:pb-0">
          {children}
        </div>
        <TabBar />
        <HotkeysHelp />
      </div>
    </UnreadCtx.Provider>
  );
}
