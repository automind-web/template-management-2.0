"use client";

import { LogOut, Settings } from "lucide-react";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageHeader } from "@/components/cabinet/page-header";
import { LoadError, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { formatDateTime, t } from "@/lib/i18n";

type SessionInfo = { id: string; userAgent: string | null; createdAt: number; lastSeenAt: number; current: boolean };

export default function ProfilePage() {
  const { me } = useCabinet();
  return (
    <>
      <PageHeader
        title={t("profile.title")}
        actions={
          me.capabilities.viewSystemSettings ? (
            <Button asChild variant="outline">
              <a href="/settings">
                <Settings />
                {t("profile.systemSettings")}
              </a>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <PersonalCard />
        <PasswordCard />
        <SessionsCard />
        <Card>
          <CardContent className="pt-4 sm:pt-6">
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await api("POST", "/api/auth/logout", {}, { redirectOn401: false }).catch(() => {});
                window.location.assign("/login?reason=logout");
              }}
            >
              <LogOut />
              {t("profile.logout")}
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{value}</dd>
    </div>
  );
}

function PersonalCard() {
  const { me, refreshMe } = useCabinet();
  const [name, setName] = React.useState(me.user.displayName);
  const [saved, setSaved] = React.useState(false);
  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", "/api/me", { displayName: name });
    await refreshMe();
    setSaved(true);
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.personal")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2">
          <Row label={t("profile.login")} value={me.user.login} />
          <Row label={t("profile.company")} value={me.company.name} />
          <Row label={t("profile.role")} value={t(`roles.${me.role}`)} />
          <Row label={t("profile.branch")} value={me.role === "director" ? t("profile.branchAll") : (me.branch?.name ?? "—")} />
          <Row
            label={t("profile.phone")}
            value={me.user.phoneLinked ? t("profile.phoneLinked", { phone: me.user.phoneMasked ?? "" }) : t("profile.phoneNotLinked")}
          />
        </dl>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {saved ? <Alert tone="success">{t("profile.saved")}</Alert> : null}
          <Field label={t("profile.displayName")} error={fieldErrors.displayName}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="name" />
          </Field>
          <div>
            <Button type="submit" disabled={pending || name.trim() === me.user.displayName}>
              {pending ? <Spinner /> : null}
              {t("app.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
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
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.password")}</CardTitle>
      </CardHeader>
      <CardContent>
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
          <Field label={t("profile.currentPassword")} error={fieldErrors.currentPassword}>
            <Input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field
            label={t("profile.newPassword")}
            hint={t("invite.passwordHint", { n: companyConfig.auth.minPasswordLength })}
            error={fieldErrors.newPassword}
          >
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              required
              minLength={companyConfig.auth.minPasswordLength}
            />
          </Field>
          <div>
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("profile.changePassword")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function describeAgent(ua: string | null): string {
  if (!ua) return "—";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [browser, os].filter(Boolean).join(", ") || ua.slice(0, 40);
}

function SessionsCard() {
  const [sessions, setSessions] = React.useState<SessionInfo[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  const load = React.useCallback(() => {
    setFailed(false);
    api<{ sessions: SessionInfo[] }>("GET", "/api/me/sessions")
      .then((r) => setSessions(r.sessions))
      .catch(() => setFailed(true));
  }, []);
  React.useEffect(load, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.sessions")}</CardTitle>
      </CardHeader>
      <CardContent>
        {failed ? (
          <LoadError onRetry={load} />
        ) : !sessions ? (
          <Spinner />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium">
                    {describeAgent(s.userAgent)} {s.current ? <span className="text-primary">· {t("profile.sessionCurrent")}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("profile.sessionLastSeen", { date: formatDateTime(s.lastSeenAt) })}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const r = await api<{ current: boolean }>("DELETE", `/api/me/sessions/${s.id}`).catch(() => null);
                    if (r?.current) window.location.assign("/login?reason=logout");
                    else load();
                  }}
                >
                  {t("profile.sessionRevoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
