"use client";

import * as React from "react";
import { AuthShell, CopyField, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { formatDateTime, t } from "@/lib/i18n";

type Status = { needsSetup: boolean; companyExists: boolean; activationCodeConfigured: boolean };

export default function SetupPage() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [code, setCode] = React.useState("");
  const [companyName, setCompanyName] = React.useState(companyConfig.name);
  const [timezone, setTimezone] = React.useState(companyConfig.timezone);
  const [result, setResult] = React.useState<{ inviteUrl: string; expiresAt: number } | null>(null);

  React.useEffect(() => {
    api<Status>("GET", "/api/setup/status", undefined, { redirectOn401: false }).then(setStatus).catch(() => {});
  }, []);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const r = await api<{ inviteUrl: string; expiresAt: number }>(
      "POST",
      "/api/setup/owner-invite",
      { code, companyName, timezone },
      { redirectOn401: false },
    );
    setResult(r);
  });

  if (status && !status.needsSetup) {
    return (
      <AuthShell title={t("setup.title")}>
        <Alert>{t("setup.alreadyDone")}</Alert>
        <Button asChild className="mt-4 w-full">
          <a href="/login">{t("invite.toLogin")}</a>
        </Button>
      </AuthShell>
    );
  }

  if (result) {
    return (
      <AuthShell title={t("setup.resultTitle")}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{t("setup.resultHint", { date: formatDateTime(result.expiresAt) })}</p>
          <CopyField value={result.inviteUrl} />
          <Button asChild className="w-full">
            <a href={result.inviteUrl}>{t("app.open")}</a>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("setup.title")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <p className="text-sm text-muted-foreground">{t("setup.intro")}</p>
        {status && !status.activationCodeConfigured ? <Alert tone="danger">{t("setup.codeMissing")}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t("setup.code")} error={fieldErrors.code}>
          <Input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
        </Field>
        {!status?.companyExists ? (
          <>
            <Field label={t("setup.companyName")} error={fieldErrors.companyName}>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={120} />
            </Field>
            <Field label={t("setup.timezone")} error={fieldErrors.timezone}>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </Field>
          </>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          {t("setup.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
