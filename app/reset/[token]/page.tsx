"use client";

import { useParams } from "next/navigation";
import * as React from "react";
import { AuthShell, TextLink, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";

/** Установка нового пароля по одноразовой ссылке от руководителя или директора. */
export default function ResetPage() {
  const { token } = useParams<{ token: string }>();
  const [valid, setValid] = React.useState<boolean | null>(null);
  const [password, setPassword] = React.useState("");

  React.useEffect(() => {
    api<{ valid: boolean }>("GET", `/api/auth/reset?token=${encodeURIComponent(token)}`, undefined, { redirectOn401: false })
      .then((r) => setValid(r.valid))
      .catch(() => setValid(false));
  }, [token]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("POST", "/api/auth/reset", { token, password }, { redirectOn401: false });
    window.location.assign("/login?reason=reset");
  });

  if (valid === false) {
    return (
      <AuthShell title={t("reset.title")}>
        <Alert tone="danger">{t("errors.reset_link_invalid")}</Alert>
        <TextLink href="/login" className="mt-4 inline-block">
          {t("invite.toLogin")}
        </TextLink>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("reset.title")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t("reset.password")} hint={t("invite.passwordHint", { n: companyConfig.auth.minPasswordLength })} error={fieldErrors.password}>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={companyConfig.auth.minPasswordLength}
            autoFocus
          />
        </Field>
        <Button type="submit" size="lg" disabled={pending || valid === null} className="w-full">
          {pending ? <Spinner /> : null}
          {t("reset.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
