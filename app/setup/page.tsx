"use client";

import * as React from "react";
import { AuthShell, CopyField, TextLink, useSubmit } from "@/components/forms";
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
  const [companyName, setCompanyName] = React.useState("");
  const [ttl, setTtl] = React.useState(String(companyConfig.invitations.ownerTtlHours));
  const [result, setResult] = React.useState<{ inviteUrl: string; expiresAt: number } | null>(null);

  React.useEffect(() => {
    api<Status>("GET", "/api/setup/status", undefined, { redirectOn401: false }).then(setStatus).catch(() => {});
  }, []);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    setResult(
      await api<{ inviteUrl: string; expiresAt: number }>(
        "POST",
        "/api/setup/owner-invite",
        { code, companyName: companyName.trim() || undefined, ttlHours: Number(ttl) || undefined },
        { redirectOn401: false },
      ),
    );
  });

  if (status && !status.needsSetup) {
    return (
      <AuthShell title={t("setup.title")}>
        <Alert>{t("setup.alreadyDone")}</Alert>
        <TextLink href="/login" className="mt-4 inline-block">
          {t("invite.toLogin")}
        </TextLink>
      </AuthShell>
    );
  }

  if (result) {
    return (
      <AuthShell title={t("setup.resultTitle")} description={t("setup.resultHint", { date: formatDateTime(result.expiresAt) })}>
        <div className="flex flex-col gap-4">
          <CopyField value={result.inviteUrl} />
          <Button asChild size="lg" className="w-full">
            <a href={result.inviteUrl}>{t("setup.openInvite")}</a>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("setup.title")} description={t("setup.intro")}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {status && !status.activationCodeConfigured ? <Alert tone="danger">{t("setup.codeMissing")}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label={t("setup.code")} error={fieldErrors.code}>
          <Input type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
        </Field>
        {!status?.companyExists ? (
          <Field label={t("setup.companyName")} error={fieldErrors.companyName}>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={120} />
          </Field>
        ) : null}
        <Field label={t("setup.ttl")} error={fieldErrors.ttlHours}>
          <Input type="number" min={1} max={720} value={ttl} onChange={(e) => setTtl(e.target.value)} required />
        </Field>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? <Spinner /> : null}
          {t("setup.submit")}
        </Button>
      </form>
    </AuthShell>
  );
}
