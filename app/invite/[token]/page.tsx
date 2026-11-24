"use client";

import { useParams } from "next/navigation";
import * as React from "react";
import { AuthShell, LoadError, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { errorText, formatDateTime, t } from "@/lib/i18n";

type Lookup =
  | { valid: false; reason: string }
  | {
      valid: true;
      kind: "owner" | "member";
      role: "employee" | "manager" | "director";
      companyName: string;
      branchName: string | null;
      expiresAt: number;
    };

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = React.useState<Lookup | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [displayName, setDisplayName] = React.useState("");
  const [login, setLogin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [repeat, setRepeat] = React.useState("");
  const [mismatch, setMismatch] = React.useState(false);

  const load = React.useCallback(() => {
    setLoadFailed(false);
    api<Lookup>("GET", `/api/invites/lookup?token=${encodeURIComponent(token)}`, undefined, { redirectOn401: false })
      .then(setInfo)
      .catch(() => setLoadFailed(true));
  }, [token]);

  React.useEffect(load, [load]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("POST", "/api/invites/accept", { token, login, displayName, password }, { redirectOn401: false });
    window.location.assign("/tasks");
  });

  if (loadFailed) {
    return (
      <AuthShell title={t("invite.title")}>
        <LoadError onRetry={load} />
      </AuthShell>
    );
  }
  if (!info) {
    return (
      <AuthShell title={t("invite.title")}>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner /> {t("app.loading")}
        </p>
      </AuthShell>
    );
  }
  if (!info.valid) {
    return (
      <AuthShell title={t("invite.invalid")}>
        <Alert tone="danger">{errorText(info.reason)}</Alert>
        <Button asChild variant="outline" className="mt-4 w-full">
          <a href="/login">{t("invite.toLogin")}</a>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("invite.title")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== repeat) {
            setMismatch(true);
            return;
          }
          setMismatch(false);
          void run();
        }}
      >
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="font-medium">{t("invite.for", { company: info.companyName })}</p>
          <p>{t("invite.role", { role: t(`roles.${info.role}`) })}</p>
          {info.branchName ? <p className="break-words">{t("invite.branch", { branch: info.branchName })}</p> : null}
          <p className="text-muted-foreground">{t("invite.expires", { date: formatDateTime(info.expiresAt) })}</p>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t("invite.displayName")} error={fieldErrors.displayName}>
          <Input autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} autoFocus />
        </Field>
        <Field label={t("invite.login")} hint={t("invite.loginHint")} error={fieldErrors.login}>
          <Input
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            minLength={3}
            maxLength={40}
          />
        </Field>
        <Field
          label={t("invite.password")}
          hint={t("invite.passwordHint", { n: companyConfig.auth.minPasswordLength })}
          error={fieldErrors.password}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={companyConfig.auth.minPasswordLength}
          />
        </Field>
        <Field label={t("invite.passwordRepeat")} error={mismatch ? t("invite.passwordMismatch") : undefined}>
          <Input type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          {t("invite.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
