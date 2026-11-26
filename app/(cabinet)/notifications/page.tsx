"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState, PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Section, Spinner, StateDot } from "@/components/ui/card";
import { Checkbox, Input, NativeSelect } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { errorText, t } from "@/lib/i18n";
import { canInstall, disablePush, enablePush, isStandalone, onInstallChange, promptInstall, pushPermission, type PushState } from "@/lib/pwa";
import { cn } from "@/lib/utils";

const EVENTS = ["assigned", "dueSoon", "overdue", "submitted", "returned", "accepted", "comment"] as const;
const REMIND = [15, 60, 180, 1440, 4320] as const;

type Prefs = {
  channels: { whatsapp: boolean; push: boolean };
  events: Record<(typeof EVENTS)[number], boolean>;
  remindBefore: number[];
  quiet: { enabled: boolean; from: string; to: string };
  workDaysOnly: boolean;
  pausedUntil: number | null;
};
type Data = {
  items: { id: string; title: string; body: string; url: string | null; at: number; read: boolean }[];
  unread: number;
  scheduled: number;
  prefs: Prefs;
  channels: { whatsapp: { linked: boolean; configured: boolean }; push: { configured: boolean; vapidPublicKey: string | null } };
};

export default function NotificationsPage() {
  const [data, setData] = React.useState<Data | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    setError(null);
    api<Data>("GET", "/api/notifications")
      .then(setData)
      .catch((e) => setError(errorText(e instanceof ApiError ? e.code : "network")));
  }, []);
  React.useEffect(load, [load]);

  return (
    <>
      <PageHeader title={t("nav.notifications")} />
      <PageBody className="flex max-w-4xl flex-col gap-4">
        {error ? <LoadError message={error} onRetry={load} /> : null}
        {!data && !error ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> {t("app.loading")}
          </p>
        ) : null}
        {data ? (
          <>
            <Inbox data={data} onChanged={load} />
            <PrefsForm data={data} onSaved={load} />
          </>
        ) : null}
      </PageBody>
    </>
  );
}

function Inbox({ data, onChanged }: { data: Data; onChanged: () => void }) {
  const { me } = useCabinet();
  const router = useRouter();
  const open = async (item: Data["items"][number]) => {
    if (!item.read) await api("POST", "/api/notifications/read", { ids: [item.id] }).catch(() => {});
    // Права проверяются заново при открытии карточки.
    if (item.url) router.push(item.url);
    else onChanged();
  };
  return (
    <Section
      title={t("notifications.inbox")}
      actions={
        data.unread ? (
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await api("POST", "/api/notifications/read", { all: true }).catch(() => {});
              onChanged();
            }}
          >
            {t("notifications.readAll")}
          </Button>
        ) : null
      }
    >
      {data.items.length === 0 ? (
        <EmptyState icon={<Bell className="size-6" />} title={t("notifications.empty")} text={t("notifications.emptyText")} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {data.items.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => void open(item)} className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-muted/50">
                <span className="min-w-0">
                  <span className={cn("block break-words text-[15px]", item.read ? "text-foreground/75" : "font-bold")}>{item.title}</span>
                  {item.body ? <span className="block break-words text-sm text-muted-foreground">{item.body}</span> : null}
                </span>
                <span className={cn("shrink-0 text-sm", item.read ? "text-muted-foreground" : "font-semibold text-foreground/80")}>
                  {formatShortDateTime(item.at, me.company.timezone)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-sm text-muted-foreground">{t("notifications.scheduled", { n: data.scheduled })}</p>
    </Section>
  );
}

function PrefsForm({ data, onSaved }: { data: Data; onSaved: () => void }) {
  const [prefs, setPrefs] = React.useState<Prefs>(data.prefs);
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [push, setPush] = React.useState<PushState>("default");
  const [installable, setInstallable] = React.useState(false);
  const [standalone, setStandalone] = React.useState(false);

  React.useEffect(() => {
    setPush(pushPermission());
    setInstallable(canInstall());
    setStandalone(isStandalone());
    return onInstallChange(() => setInstallable(canInstall()));
  }, []);

  /** Каждое изменение сохраняется сразу; очередь напоминаний пересчитывается на сервере. */
  const save = async (next: Prefs) => {
    setPrefs(next);
    setSaving(true);
    setMessage(null);
    try {
      await api("PATCH", "/api/notifications/prefs", next);
      setMessage({ tone: "success", text: t("profile.saved") });
      onSaved();
    } catch (e) {
      setMessage({ tone: "danger", text: errorText(e instanceof ApiError ? e.code : "network") });
    } finally {
      setSaving(false);
    }
  };

  const togglePush = async (on: boolean) => {
    if (on) {
      if (!data.channels.push.vapidPublicKey) return;
      const state = await enablePush(data.channels.push.vapidPublicKey).catch(() => pushPermission());
      setPush(state);
      if (state !== "granted") return;
    } else {
      await disablePush();
    }
    await save({ ...prefs, channels: { ...prefs.channels, push: on } });
  };

  const pushReady = data.channels.push.configured && push !== "unsupported" && push !== "denied";
  const pauseOptions = [
    { value: "", label: t("notifications.pause.none") },
    { value: String(60), label: t("notifications.pause.hour") },
    { value: String(8 * 60), label: t("notifications.pause.hours8") },
    { value: String(24 * 60), label: t("notifications.pause.day") },
    { value: String(7 * 24 * 60), label: t("notifications.pause.week") },
  ];

  return (
    <>
      <Section title={t("notifications.channels")} actions={saving ? <Spinner className="text-muted-foreground" /> : null}>
        <div className="flex flex-col gap-3">
          <ChannelRow label={t("notifications.cabinet")} checked disabled state={<StateDot ok>{t("notifications.works")}</StateDot>} onChange={() => {}} />
          <ChannelRow
            label="WhatsApp"
            checked={prefs.channels.whatsapp && data.channels.whatsapp.linked}
            disabled={!data.channels.whatsapp.linked || !data.channels.whatsapp.configured}
            state={
              !data.channels.whatsapp.configured ? (
                <StateDot ok={false}>{t("notifications.whatsappOff")}</StateDot>
              ) : data.channels.whatsapp.linked ? (
                <StateDot ok>{t("notifications.whatsappLinked")}</StateDot>
              ) : (
                <StateDot ok={false}>{t("notifications.whatsappNotLinked")}</StateDot>
              )
            }
            onChange={(on) => void save({ ...prefs, channels: { ...prefs.channels, whatsapp: on } })}
          />
          <ChannelRow
            label={t("notifications.push")}
            checked={prefs.channels.push && push === "granted"}
            disabled={!pushReady}
            state={
              !data.channels.push.configured ? (
                <StateDot ok={false}>{t("notifications.pushServerOff")}</StateDot>
              ) : push === "denied" ? (
                <StateDot ok={false}>{t("notifications.pushDenied")}</StateDot>
              ) : push === "unsupported" ? (
                <StateDot ok={false}>{t("notifications.pushUnsupported")}</StateDot>
              ) : prefs.channels.push && push === "granted" ? (
                <StateDot ok>{t("notifications.works")}</StateDot>
              ) : (
                <span className="text-sm text-muted-foreground">{t("notifications.pushOff")}</span>
              )
            }
            onChange={(on) => void togglePush(on)}
          />
          {!data.channels.whatsapp.linked ? (
            <p className="text-sm text-muted-foreground">
              {t("notifications.linkHint")}{" "}
              <Link href="/profile" className="text-primary hover:underline">
                {t("notifications.linkPath")}
              </Link>
              .
            </p>
          ) : null}
          {push === "denied" ? <p className="text-sm text-muted-foreground">{t("notifications.pushDeniedHint")}</p> : null}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            {standalone ? (
              <span className="text-sm text-muted-foreground">{t("notifications.installed")}</span>
            ) : installable ? (
              <Button variant="outline" onClick={() => void promptInstall()}>
                {t("notifications.install")}
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">{t("notifications.installHint")}</span>
            )}
          </div>
        </div>
      </Section>

      <Section title={t("notifications.events")}>
        <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {EVENTS.map((e) => (
            <Checkbox key={e} label={t(`notifications.event.${e}`)} checked={prefs.events[e]} onChange={(ev) => void save({ ...prefs, events: { ...prefs.events, [e]: ev.target.checked } })} />
          ))}
        </div>
        <p className="mb-2 mt-5 text-[15px] font-semibold">{t("notifications.remindBefore")}</p>
        <div className="flex flex-wrap gap-2">
          {REMIND.map((m) => {
            const on = prefs.remindBefore.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                disabled={!prefs.events.dueSoon}
                onClick={() => void save({ ...prefs, remindBefore: on ? prefs.remindBefore.filter((x) => x !== m) : [...prefs.remindBefore, m].sort((a, b) => a - b) })}
                className={cn(
                  "h-9 rounded-full border px-3.5 text-sm font-semibold disabled:opacity-50",
                  on ? "border-primary/30 bg-selected" : "border-border bg-surface text-foreground/80 hover:bg-muted",
                )}
              >
                {t(`notifications.remind.${m}`)}
              </button>
            );
          })}
        </div>
      </Section>

      <Section title={t("notifications.mode")}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Checkbox label={t("notifications.quiet")} checked={prefs.quiet.enabled} onChange={(e) => void save({ ...prefs, quiet: { ...prefs.quiet, enabled: e.target.checked } })} />
            <Input
              type="time"
              aria-label={t("notifications.quietFrom")}
              value={prefs.quiet.from}
              disabled={!prefs.quiet.enabled}
              onChange={(e) => setPrefs({ ...prefs, quiet: { ...prefs.quiet, from: e.target.value } })}
              onBlur={() => void save(prefs)}
              className="w-32"
            />
            <span className="text-muted-foreground">—</span>
            <Input
              type="time"
              aria-label={t("notifications.quietTo")}
              value={prefs.quiet.to}
              disabled={!prefs.quiet.enabled}
              onChange={(e) => setPrefs({ ...prefs, quiet: { ...prefs.quiet, to: e.target.value } })}
              onBlur={() => void save(prefs)}
              className="w-32"
            />
          </div>
          <Checkbox label={t("notifications.workDaysOnly")} checked={prefs.workDaysOnly} onChange={(e) => void save({ ...prefs, workDaysOnly: e.target.checked })} />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[15px]">{t("notifications.pause.label")}</span>
            <NativeSelect
              aria-label={t("notifications.pause.label")}
              value=""
              onChange={(e) => void save({ ...prefs, pausedUntil: e.target.value ? Date.now() + Number(e.target.value) * 60_000 : null })}
              className="w-56"
            >
              {pauseOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            {prefs.pausedUntil && prefs.pausedUntil > Date.now() ? (
              <span className="text-sm font-semibold text-warning">
                {t("notifications.pause.until", { date: formatShortDateTime(prefs.pausedUntil, Intl.DateTimeFormat().resolvedOptions().timeZone) })}
              </span>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">{t("notifications.modeHint")}</p>
          {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
        </div>
      </Section>
    </>
  );
}

function ChannelRow({
  label,
  checked,
  disabled,
  state,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  state: React.ReactNode;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Checkbox label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {state}
    </div>
  );
}
