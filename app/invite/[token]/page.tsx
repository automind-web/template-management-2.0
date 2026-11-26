"use client";

import { useParams } from "next/navigation";
import * as React from "react";
import { AuthShell, LoadError, TextLink, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Lookup =
  | { valid: false; reason: string }
  | {
      valid: true;
      kind: "owner" | "member";
      role: "employee" | "manager" | "director";
      companyName: string;
      branchName: string | null;
      nameHint: string | null;
      expiresAt: number;
    };

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = React.useState<Lookup | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [mode, setMode] = React.useState<"new" | "existing">("new");

  const load = React.useCallback(() => {
    setLoadFailed(false);
    api<Lookup>("GET", `/api/invites/lookup?token=${encodeURIComponent(token)}`, undefined, { redirectOn401: false })
      .then(setInfo)
      .catch(() => setLoadFailed(true));
  }, [token]);
  React.useEffect(load, [load]);

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
        <TextLink href="/login" className="mt-4 inline-block">
          {t("invite.toLogin")}
        </TextLink>
      </AuthShell>
    );
  }

  const subtitle = [info.companyName, info.branchName, t(`roles.${info.role}`)].filter(Boolean).join(" · ");
  return (
    <AuthShell title={t("invite.title")} description={subtitle}>
      {info.kind === "member" ? (
        <div role="tablist" aria-label={t("invite.title")} className="mb-4 grid grid-cols-2 overflow-hidden rounded-md border border-border text-[15px] font-semibold">
          {(["new", "existing"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn("px-3 py-2.5", mode === m ? "bg-selected text-foreground" : "text-foreground/70 hover:bg-muted")}
            >
              {t(`invite.mode.${m}`)}
            </button>
          ))}
        </div>
      ) : null}
      {mode === "new" || info.kind === "owner" ? <NewAccountForm token={token} nameHint={info.nameHint} /> : <ExistingAccountForm token={token} />}
    </AuthShell>
  );
}

function NewAccountForm({ token, nameHint }: { token: string; nameHint: string | null }) {
  const [displayName, setDisplayName] = React.useState(nameHint ?? "");
  const [login, setLogin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [repeat, setRepeat] = React.useState("");
  const [mismatch, setMismatch] = React.useState(false);
  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("POST", "/api/invites/accept", { token, login, displayName, password }, { redirectOn401: false });
    window.location.assign("/tasks");
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMismatch(password !== repeat);
        if (password === repeat) void run();
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label={t("invite.displayName")} error={fieldErrors.displayName}>
        <Input autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={120} autoFocus />
      </Field>
      <Field label={t("login.login")} hint={t("invite.loginHint")} error={fieldErrors.login}>
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
      <Field label={t("login.password")} error={fieldErrors.password}>
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
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {t("invite.submit")}
      </Button>
    </form>
  );
}

function ExistingAccountForm({ token }: { token: string }) {
  const [login, setLogin] = React.useState("");
  const [password, setPassword] = React.useState("");
  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("POST", "/api/invites/accept-existing", { token, login, password }, { redirectOn401: false });
    window.location.assign("/tasks");
  });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <p className="text-sm text-muted-foreground">{t("invite.existingHint")}</p>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label={t("login.login")} error={fieldErrors.login}>
        <Input autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} required autoFocus />
      </Field>
      <Field label={t("login.password")} error={fieldErrors.password}>
        <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? <Spinner /> : null}
        {t("invite.join")}
      </Button>
    </form>
  );
}
