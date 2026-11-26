"use client";

import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { useSubmit } from "@/components/forms";
import { Button, Kbd } from "@/components/ui/button";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, NativeSelect } from "@/components/ui/input";
import { api } from "@/lib/api";
import { onSubmitShortcut, useSubmitShortcutLabel } from "@/lib/hotkeys";
import { t } from "@/lib/i18n";
import { Loading, useLoad, type SystemSettings } from "./common";

export function ProcessTab() {
  const { data, error, load } = useLoad<SystemSettings>("/api/settings");
  if (!data) return <Loading error={error} onRetry={load} />;
  return <ProcessForm data={data} onSaved={load} />;
}

function ProcessForm({ data, onSaved }: { data: SystemSettings; onSaved: () => void }) {
  const { refreshMe } = useCabinet();
  const shortcut = useSubmitShortcutLabel();
  const s = data.settings;
  const [acceptanceEnabled, setAcceptance] = React.useState(s.acceptanceEnabled);
  const [names, setNames] = React.useState<Record<string, string>>(Object.fromEntries(data.statuses.map((x) => [x.key, x.name])));
  const [cancelledName, setCancelledName] = React.useState(s.cancelledName);
  const [employeeSeesColleagues, setVisibility] = React.useState(s.employeeSeesColleagues);
  const [speedFrom, setSpeedFrom] = React.useState(s.speedFrom);
  const [assistantName, setAssistantName] = React.useState(s.assistantName);
  const [assistantModel, setAssistantModel] = React.useState(s.assistantModel);
  const [saved, setSaved] = React.useState(false);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", "/api/settings/process", {
      acceptanceEnabled,
      statusNames: names,
      cancelledName,
      employeeSeesColleagues,
      speedFrom,
      assistantName,
      assistantModel,
    });
    await refreshMe();
    onSaved();
    setSaved(true);
  });

  return (
    <Card className="p-4 sm:p-5">
      <form
        className="flex flex-col gap-5"
        onKeyDown={onSubmitShortcut}
        onChange={() => setSaved(false)}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {saved ? <Alert tone="success">{t("profile.saved")}</Alert> : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-[17px] font-bold">{t("settings.process.workflow")}</legend>
          <Checkbox label={t("settings.process.acceptance")} checked={acceptanceEnabled} onChange={(e) => setAcceptance(e.target.checked)} />
          <div className="grid gap-4 sm:grid-cols-2">
            {data.statuses.map((st) => (
              <Field key={st.key} label={t("settings.process.statusName", { key: st.key })} error={fieldErrors[`statusNames.${st.key}`]}>
                <Input
                  value={names[st.key] ?? ""}
                  onChange={(e) => setNames((n) => ({ ...n, [st.key]: e.target.value }))}
                  required
                  maxLength={40}
                  disabled={st.category === "review" && !acceptanceEnabled}
                />
              </Field>
            ))}
            <Field label={t("settings.process.statusName", { key: "canceled" })} error={fieldErrors.cancelledName}>
              <Input value={cancelledName} onChange={(e) => setCancelledName(e.target.value)} required maxLength={40} />
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-[17px] font-bold">{t("settings.process.visibility")}</legend>
          <Checkbox label={t("settings.process.colleagues")} checked={employeeSeesColleagues} onChange={(e) => setVisibility(e.target.checked)} />
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-[17px] font-bold">{t("settings.process.stats")}</legend>
          <Field label={t("settings.process.speedFrom")}>
            <NativeSelect value={speedFrom} onChange={(e) => setSpeedFrom(e.target.value as "started" | "assigned")}>
              <option value="started">{t("settings.process.speed.started")}</option>
              <option value="assigned">{t("settings.process.speed.assigned")}</option>
            </NativeSelect>
          </Field>
        </fieldset>

        <fieldset>
          <legend className="mb-3 text-[17px] font-bold">{t("settings.process.assistant")}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.process.assistantName")} error={fieldErrors.assistantName}>
              <Input value={assistantName} onChange={(e) => setAssistantName(e.target.value)} required maxLength={40} />
            </Field>
            <Field label={t("settings.process.model")}>
              <NativeSelect value={assistantModel} onChange={(e) => setAssistantModel(e.target.value)}>
                {data.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </fieldset>

        <div>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner /> : null}
            {t("app.save")}
            <Kbd>{shortcut}</Kbd>
          </Button>
        </div>
      </form>
    </Card>
  );
}
