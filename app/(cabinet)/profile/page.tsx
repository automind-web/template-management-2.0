"use client";

import Link from "next/link";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Meta, Section, Spinner, StateDot } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Label } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { logout } from "@/lib/pwa";

type SessionInfo = { id: string; userAgent: string | null; lastSeenAt: number; current: boolean };

export default function ProfilePage() {
  const { me } = useCabinet();
  return (
    <>
      <PageHeader title={t("profile.title")} />
      <PageBody className="flex max-w-3xl flex-col gap-4">
        <PersonalSection />
        <Section title="WhatsApp">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StateDot ok={me.user.phoneLinked}>
              {me.user.phoneLinked ? t("profile.phoneLinked", { phone: me.user.phoneMasked ?? "" }) : t("profile.phoneNotLinked")}
            </StateDot>
            <Button variant="outline" disabled title={t("profile.phoneSoon")}>
              {t("profile.linkPhone")}
            </Button>
          </div>
        </Section>
        <PasswordSection />
        <SessionsSection />
        <Section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {me.capabilities.viewSystemSettings ? (
              <Button asChild variant="outline">
                <Link href="/settings">{t("nav.settings")}</Link>
              </Button>
            ) : (
              <span />
            )}
            <Button
              variant="danger"
              onClick={() => void logout()}
            >
              {t("profile.logout")}
            </Button>
          </div>
        </Section>
      </PageBody>
    </>
  );
}

function PersonalSection() {
  const { me, refreshMe } = useCabinet();
  const [name, setName] = React.useState(me.user.displayName);
  const [saved, setSaved] = React.useState(false);
  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", "/api/me", { displayName: name });
    await refreshMe();
    setSaved(true);
  });
  return (
    <Section title={t("profile.personal")}>
      <dl className="mb-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Meta label={t("profile.company")}>{me.company.name}</Meta>
        <Meta label={t("profile.role")}>{t(`roles.${me.role}`)}</Meta>
        <Meta label={t("profile.branch")}>{me.role === "director" ? t("profile.branchAll") : (me.branch?.name ?? "—")}</Meta>
        <Meta label={t("profile.login")}>{me.user.login}</Meta>
      </dl>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          void run();
        }}
        className="flex flex-col gap-2"
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Label htmlFor="profile-name">{t("profile.displayName")}</Label>
        <div className="flex gap-2">
          <Input
            id="profile-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            required
            maxLength={120}
            autoComplete="name"
            aria-invalid={Boolean(fieldErrors.displayName) || undefined}
          />
          <Button type="submit" variant="outline" disabled={pending || name.trim() === me.user.displayName}>
            {pending ? <Spinner /> : null}
            {saved ? t("profile.saved") : t("app.save")}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrent] = React.useState("");
  const [newPassword, setNew] = React.useState("");
  const [done, setDone] = React.useState(false);
  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("POST", "/api/me/password", { currentPassword, newPassword });
    setCurrent("");
    setNew("");
    setDone(true);
  });
  return (
    <Section title={t("profile.password")}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(false);
          void run();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {done ? <Alert tone="success">{t("profile.passwordChanged")}</Alert> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("profile.currentPassword")} error={fieldErrors.currentPassword}>
            <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label={t("profile.newPassword")} error={fieldErrors.newPassword}>
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              required
              minLength={companyConfig.auth.minPasswordLength}
            />
          </Field>
        </div>
        <div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? <Spinner /> : null}
            {t("profile.changePassword")}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "—";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(", ") || ua.slice(0, 40);
}

/** Сеансы: вход на других устройствах можно завершить. */
function SessionsSection() {
  const { me } = useCabinet();
  const [sessions, setSessions] = React.useState<SessionInfo[] | null>(null);
  const load = React.useCallback(() => {
    api<{ sessions: SessionInfo[] }>("GET", "/api/me/sessions")
      .then((r) => setSessions(r.sessions))
      .catch(() => setSessions([]));
  }, []);
  React.useEffect(load, [load]);
  if (!sessions || sessions.length < 2) return null;
  return (
    <Section title={t("profile.sessions")}>
      <ul className="flex flex-col divide-y divide-border">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0 text-[15px]">
              <p className="truncate font-semibold">
                {describeAgent(s.userAgent)}
                {s.current ? <span className="font-normal text-muted-foreground"> · {t("profile.sessionCurrent")}</span> : null}
              </p>
              <p className="text-sm text-muted-foreground">{formatShortDateTime(s.lastSeenAt, me.company.timezone)}</p>
            </div>
            {!s.current ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await api("DELETE", `/api/me/sessions/${s.id}`).catch(() => null);
                  load();
                }}
              >
                {t("profile.sessionRevoke")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
