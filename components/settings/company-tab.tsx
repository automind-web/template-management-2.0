"use client";

import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { useSubmit } from "@/components/forms";
import { Button, Kbd } from "@/components/ui/button";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Label, NativeSelect } from "@/components/ui/input";
import { api } from "@/lib/api";
import { onSubmitShortcut, useSubmitShortcutLabel } from "@/lib/hotkeys";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loading, useLoad, type SystemSettings } from "./common";

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function CompanyTab() {
  const { data, error, load } = useLoad<SystemSettings>("/api/settings");
  if (!data) return <Loading error={error} onRetry={load} />;
  return <CompanyForm data={data} onSaved={load} />;
}

function CompanyForm({ data, onSaved }: { data: SystemSettings; onSaved: () => void }) {
  const { refreshMe } = useCabinet();
  const shortcut = useSubmitShortcutLabel();
  const [form, setForm] = React.useState({
    name: data.company.name,
    timezone: data.company.timezone,
    accent: data.settings.accent,
    logoUrl: data.settings.logoUrl,
    fontFamily: data.settings.fontFamily,
    dueTime: data.settings.dueTime,
    workDays: data.settings.workDays,
  });
  const [saved, setSaved] = React.useState(false);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", "/api/settings/company", { ...form, logoUrl: form.logoUrl.trim(), fontFamily: form.fontFamily.trim() });
    // Оформление применяется сразу, без перезагрузки.
    document.documentElement.style.setProperty("--am-accent", form.accent);
    if (form.fontFamily.trim()) document.documentElement.style.setProperty("--am-font", `${form.fontFamily.trim()}, ui-sans-serif, system-ui, sans-serif`);
    else document.documentElement.style.removeProperty("--am-font");
    await refreshMe();
    onSaved();
    setSaved(true);
  });

  return (
    <Card className="p-4 sm:p-5">
      <form
        className="flex flex-col gap-4"
        onKeyDown={onSubmitShortcut}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {saved ? <Alert tone="success">{t("profile.saved")}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.company.name")} error={fieldErrors.name}>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} className="font-semibold" />
          </Field>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="accent-hex">{t("settings.company.accent")}</Label>
            <div className="flex gap-2">
              <input
                type="color"
                value={form.accent}
                onChange={(e) => set({ accent: e.target.value })}
                aria-label={t("settings.company.accent")}
                className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-surface p-1"
              />
              <Input
                id="accent-hex"
                value={form.accent}
                onChange={(e) => set({ accent: e.target.value })}
                pattern="#[0-9a-fA-F]{6}"
                required
                aria-invalid={Boolean(fieldErrors.accent) || undefined}
                className="font-mono"
              />
            </div>
          </div>
          <Field label={t("settings.company.logo")} error={fieldErrors.logoUrl}>
            <Input type="url" value={form.logoUrl} onChange={(e) => set({ logoUrl: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label={t("settings.company.font")} error={fieldErrors.fontFamily}>
            <Input value={form.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} placeholder="Inter, Arial" />
          </Field>
          <Field label={t("settings.company.timezone")} error={fieldErrors.timezone}>
            <NativeSelect value={form.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {data.timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("settings.company.dueTime")} hint={t("settings.company.dueTimeHint")} error={fieldErrors.dueTime}>
            <Input type="time" value={form.dueTime} onChange={(e) => set({ dueTime: e.target.value })} required />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[15px] font-semibold">{t("settings.company.workDays")}</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d) => {
              const on = form.workDays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ workDays: on ? form.workDays.filter((x) => x !== d) : [...form.workDays, d].sort() })}
                  className={cn(
                    "size-11 rounded-full border text-sm font-semibold",
                    on ? "border-primary/30 bg-selected text-foreground" : "border-border bg-surface text-foreground/70 hover:bg-muted",
                  )}
                >
                  {t(`settings.company.days.${d}`)}
                </button>
              );
            })}
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
