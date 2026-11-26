"use client";

import * as React from "react";
import { CopyField, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Card, Spinner, StateDot } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { Loading, useLoad } from "./common";

type Connections = {
  whapi: { ok: boolean; configured: boolean; status: string; channelPhone: string | null; workNumber: string; webhookUrl: string | null };
  openai: { ok: boolean; configured: boolean; model: string };
  push: { ok: boolean; configured: boolean };
  files: { ok: boolean; configured: boolean };
};

/**
 * Реальное состояние подключений и способ восстановления.
 * Токены и ключи задаются только в секретах сайта Sites и в браузер не попадают.
 */
export function ConnectionsTab() {
  const { data, error, load } = useLoad<Connections>("/api/settings/connections");
  if (!data) return <Loading error={error} onRetry={load} />;

  const whapiState = !data.whapi.configured
    ? t("settings.connections.whapiMissing")
    : data.whapi.ok
      ? t("settings.connections.whapiOk")
      : t("settings.connections.whapiError", { status: data.whapi.status });

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-bold">{t("settings.connections.whapi")}</h2>
          <StateDot ok={data.whapi.ok}>{whapiState}</StateDot>
        </div>
        {!data.whapi.ok ? <p className="text-sm text-muted-foreground">{t("settings.connections.recovery.whapi")}</p> : null}
        {data.whapi.webhookUrl ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] font-semibold text-foreground/75">{t("settings.connections.webhook")}</p>
            <CopyField value={data.whapi.webhookUrl} />
            <p className="text-sm text-muted-foreground">{t("settings.connections.webhookHint")}</p>
          </div>
        ) : null}
        <WorkNumberForm initial={data.whapi.workNumber || data.whapi.channelPhone || ""} onSaved={load} />
        <p className="text-sm text-muted-foreground">{t("settings.connections.note.whapi")}</p>
        <div>
          <Button variant="outline" size="sm" onClick={load}>
            {t("settings.connections.check")}
          </Button>
        </div>
      </Card>

      <Card className="flex flex-col gap-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-bold">{t("settings.connections.openai")}</h2>
          <StateDot ok={data.openai.ok}>{data.openai.ok ? t("settings.connections.openaiOk", { model: data.openai.model }) : t("settings.connections.openaiMissing")}</StateDot>
        </div>
        {!data.openai.ok ? <p className="text-sm text-muted-foreground">{t("settings.connections.recovery.openai")}</p> : null}
        <p className="text-sm text-muted-foreground">{t("settings.connections.note.openai")}</p>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <h2 className="text-[17px] font-bold">{t("settings.connections.push")}</h2>
          <StateDot ok={data.push.ok}>{data.push.ok ? t("settings.connections.pushOk") : t("settings.connections.pushMissing")}</StateDot>
        </div>
        {!data.push.ok ? <p className="text-sm text-muted-foreground">{t("settings.connections.recovery.push")}</p> : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <h2 className="text-[17px] font-bold">{t("settings.connections.files")}</h2>
          <StateDot ok={data.files.ok}>{data.files.ok ? t("settings.connections.filesOk") : t("settings.connections.filesMissing")}</StateDot>
        </div>
        {!data.files.ok ? <p className="text-sm text-muted-foreground">{t("settings.connections.recovery.files")}</p> : null}
      </Card>
    </div>
  );
}

function WorkNumberForm({ initial, onSaved }: { initial: string; onSaved: () => void }) {
  const [value, setValue] = React.useState(initial);
  const [saved, setSaved] = React.useState(false);
  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", "/api/settings/whatsapp", { workNumber: value });
    setSaved(true);
    onSaved();
  });
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        void run();
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("settings.connections.workNumber")} error={fieldErrors.whapiPhone} className="min-w-64 flex-1">
          <Input inputMode="tel" value={value} onChange={(e) => setValue(e.target.value)} placeholder="79990000000" />
        </Field>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Spinner /> : null}
          {saved ? t("profile.saved") : t("app.save")}
        </Button>
      </div>
    </form>
  );
}
