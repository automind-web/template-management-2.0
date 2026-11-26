"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";
import { AuthShell, TextLink, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/api")) return "/tasks";
  return value;
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [login, setLogin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [needsSetup, setNeedsSetup] = React.useState(false);
  const reason = params.get("reason");

  React.useEffect(() => {
    api<{ needsSetup: boolean }>("GET", "/api/setup/status", undefined, { redirectOn401: false })
      .then((s) => setNeedsSetup(s.needsSetup))
      .catch(() => {});
  }, []);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("POST", "/api/auth/login", { login, password }, { redirectOn401: false });
    window.location.assign(safeNext(params.get("next")));
  });

  return (
    <AuthShell title={t("login.title")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {reason === "revoked" ? <Alert>{t("login.revoked")}</Alert> : null}
        {reason === "logout" ? <Alert>{t("login.loggedOut")}</Alert> : null}
        {reason === "reset" ? <Alert tone="success">{t("reset.success")}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t("login.login")} error={fieldErrors.login}>
          <Input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
            autoFocus
          />
        </Field>
        <Field label={t("login.password")} error={fieldErrors.password}>
          <Input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          {t("login.submit")}
        </Button>
        <div className="flex flex-col gap-2">
          <TextLink href="/recover">{t("login.forgot")}</TextLink>
          {needsSetup ? <TextLink href="/setup">{t("login.firstRun")}</TextLink> : null}
        </div>
      </form>
    </AuthShell>
  );
}
