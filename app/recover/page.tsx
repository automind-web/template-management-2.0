"use client";

import * as React from "react";
import { AuthShell, TextLink, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

/** Восстановление: код в привязанный WhatsApp, иначе — ссылка сброса от руководителя. */
export default function RecoverPage() {
  const [step, setStep] = React.useState<"login" | "code">("login");
  const [login, setLogin] = React.useState("");
  const [code, setCode] = React.useState("");
  const [password, setPassword] = React.useState("");

  const request = useSubmit(async () => {
    await api("POST", "/api/auth/recover/request", { login }, { redirectOn401: false });
    setStep("code");
  });
  const confirm = useSubmit(async () => {
    await api("POST", "/api/auth/recover", { login, code, password }, { redirectOn401: false });
    window.location.assign("/login?reason=reset");
  });

  if (step === "code") {
    return (
      <AuthShell title={t("recover.title")} description={t("recover.sent")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm.run();
          }}
        >
          {confirm.error ? <Alert tone="danger">{confirm.error}</Alert> : null}
          <Field label={t("recover.code")} error={confirm.fieldErrors.code}>
            <Input autoComplete="one-time-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
          </Field>
          <Field label={t("reset.password")} error={confirm.fieldErrors.password}>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={companyConfig.auth.minPasswordLength}
            />
          </Field>
          <Button type="submit" size="lg" disabled={confirm.pending} className="w-full">
            {confirm.pending ? <Spinner /> : null}
            {t("reset.submit")}
          </Button>
          <TextLink href="/login">{t("recover.back")}</TextLink>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("recover.title")} description={t("recover.intro")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void request.run();
        }}
      >
        {request.error ? <Alert tone="danger">{request.error}</Alert> : null}
        <Field label={t("login.login")} error={request.fieldErrors.login}>
          <Input autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
        </Field>
        <Button type="submit" size="lg" disabled={request.pending} className="w-full">
          {request.pending ? <Spinner /> : null}
          {t("recover.submit")}
        </Button>
        <TextLink href="/login">{t("recover.back")}</TextLink>
      </form>
    </AuthShell>
  );
}
