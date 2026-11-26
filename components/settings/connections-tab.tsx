"use client";

import { Card, StateDot } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { Loading, useLoad } from "./common";

type Connections = {
  whapi: { ok: boolean; configured: boolean };
  openai: { ok: boolean; configured: boolean };
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

  const rows = [
    {
      key: "whapi",
      ok: data.whapi.ok,
      state: data.whapi.configured ? t("settings.connections.whapiConfigured") : t("settings.connections.whapiMissing"),
    },
    { key: "openai", ok: data.openai.ok, state: data.openai.ok ? t("settings.connections.openaiOk") : t("settings.connections.openaiMissing") },
    { key: "push", ok: data.push.ok, state: data.push.ok ? t("settings.connections.pushOk") : t("settings.connections.pushMissing") },
    { key: "files", ok: data.files.ok, state: data.files.ok ? t("settings.connections.filesOk") : t("settings.connections.filesMissing") },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      {rows.map((r) => (
        <Card key={r.key} className="flex flex-col gap-2 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[17px] font-bold">{t(`settings.connections.${r.key}`)}</h2>
            <StateDot ok={r.ok}>{r.state}</StateDot>
          </div>
          {!r.ok ? <p className="text-sm text-muted-foreground">{t(`settings.connections.recovery.${r.key}`)}</p> : null}
          <p className="text-sm text-muted-foreground">{t(`settings.connections.note.${r.key}`)}</p>
        </Card>
      ))}
    </div>
  );
}
