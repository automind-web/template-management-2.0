"use client";

import * as React from "react";
import { AuthShell, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

export default function RecoverPage() {
  const [login, setLogin] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [done, setDone] = React.useState(false);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("POST", "/api/auth/recover", { login, code, password }, { redirectOn401: false });
    setDone(true);
  });

  if (done) {
    return (
      <AuthShell title={t("recover.title")}>
        <Alert tone="success">{t("recover.success")}</Alert>
        <Button asChild className="mt-4 w-full">
          <a href="/login">{t("invite.toLogin")}</a>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("recover.title")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("recover.intro")}</p>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t("login.login")} error={fieldErrors.login}>
          <Input autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </Field>
        <Field label={t("recover.code")} error={fieldErrors.code}>
          <Input autoComplete="one-time-code" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} required />
        </Field>
        <Field label={t("recover.newPassword")} error={fieldErrors.password}>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={companyConfig.auth.minPasswordLength}
          />
        </Field>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          {t("recover.submit")}
        </Button>
        <a className="text-sm text-primary underline-offset-4 hover:underline" href="/login">
          {t("invite.toLogin")}
        </a>
      </form>
    </AuthShell>
  );
}
