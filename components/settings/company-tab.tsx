"use client";

import { Check, Clock, ImagePlus, Palette, Trash2 } from "lucide-react";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { CompanyMark } from "@/components/cabinet/shell";
import { useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Section, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loading, useLoad } from "./common";

type Company = {
  name: string;
  timezone: string;
  accent: string;
  logoUrl: string;
  workDays: number[];
  acceptanceEnabled: boolean;
  employeeSeesColleagues: boolean;
};

const COLORS = ["#2f5bea", "#0e9f6e", "#7c3aed", "#db2777", "#ea580c", "#0891b2", "#1f2937"];

/** Часовые пояса понятными названиями городов. */
const ZONES: [string, string][] = [
  ["Asia/Almaty", "Алматы, Астана (UTC+5)"],
  ["Asia/Aqtobe", "Актобе, Атырау (UTC+5)"],
  ["Asia/Tashkent", "Ташкент (UTC+5)"],
  ["Asia/Bishkek", "Бишкек (UTC+6)"],
  ["Europe/Moscow", "Москва (UTC+3)"],
  ["Europe/Minsk", "Минск (UTC+3)"],
  ["Asia/Tbilisi", "Тбилиси (UTC+4)"],
  ["Asia/Baku", "Баку (UTC+4)"],
  ["Asia/Yekaterinburg", "Екатеринбург (UTC+5)"],
  ["Asia/Novosibirsk", "Новосибирск (UTC+7)"],
  ["Asia/Dubai", "Дубай (UTC+4)"],
  ["Europe/Istanbul", "Стамбул (UTC+3)"],
  ["Europe/Berlin", "Берлин (UTC+1)"],
  ["Europe/London", "Лондон (UTC+0)"],
];

export function CompanyTab() {
  const { data, error, load } = useLoad<Company>("/api/settings");
  if (!data) return <Loading error={error} onRetry={load} />;
  return <CompanyForm data={data} />;
}

function CompanyForm({ data }: { data: Company }) {
  const { refreshMe } = useCabinet();
  const toast = useToast();
  const [form, setForm] = React.useState(data);
  const [logo, setLogo] = React.useState(data.logoUrl);
  const [logoBusy, setLogoBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Company>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify({ ...form, logoUrl: "" }) !== JSON.stringify({ ...data, logoUrl: "" });

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", "/api/settings/company", {
      name: form.name,
      timezone: form.timezone,
      accent: form.accent,
      workDays: form.workDays,
      acceptanceEnabled: form.acceptanceEnabled,
      employeeSeesColleagues: form.employeeSeesColleagues,
    });
    document.documentElement.style.setProperty("--am-accent", form.accent);
    await refreshMe();
    toast(t("settings.saved"));
  });

  const uploadLogo = async (file: File | null) => {
    setLogoBusy(true);
    try {
      let res: Response;
      if (file) {
        const body = new FormData();
        body.set("file", file);
        res = await fetch("/api/settings/logo", { method: "POST", body, credentials: "same-origin" });
      } else {
        res = await fetch("/api/settings/logo", { method: "DELETE", credentials: "same-origin" });
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(json?.error?.code ?? "internal", res.status, null);
      setLogo(json.logoUrl);
      await refreshMe();
      toast(file ? t("settings.company.logoSaved") : t("settings.company.logoRemoved"));
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "network"), "danger");
    } finally {
      setLogoBusy(false);
    }
  };

  const zones = ZONES.some(([z]) => z === form.timezone) ? ZONES : [[form.timezone, form.timezone] as [string, string], ...ZONES];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Section title={t("settings.company.profile")} description={t("settings.company.profileHint")} icon={<Palette className="size-5" />}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-4">
            <CompanyMark name={form.name || "A"} logoUrl={logo} size={64} />
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => {
                  void uploadLogo(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" disabled={logoBusy} onClick={() => fileRef.current?.click()}>
                {logoBusy ? <Spinner /> : <ImagePlus />}
                {logo ? t("settings.company.logoReplace") : t("settings.company.logoUpload")}
              </Button>
              {logo ? (
                <Button variant="ghost" size="sm" disabled={logoBusy} onClick={() => void uploadLogo(null)}>
                  <Trash2 />
                  {t("settings.company.logoRemove")}
                </Button>
              ) : null}
              <p className="w-full text-xs text-muted-foreground">{t("settings.company.logoHint")}</p>
            </div>
          </div>
          <Field label={t("settings.company.name")} error={fieldErrors.name}>
            <Input value={form.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} className="text-base font-semibold" />
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-foreground/75">{t("settings.company.color")}</p>
            <div className="flex flex-wrap items-center gap-2.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={form.accent.toLowerCase() === c}
                  onClick={() => set({ accent: c })}
                  className="am-lift flex size-9 items-center justify-center rounded-full ring-offset-2 aria-pressed:ring-2 aria-pressed:ring-foreground/30"
                  style={{ background: c }}
                >
                  {form.accent.toLowerCase() === c ? <Check className="size-4 text-white" /> : null}
                </button>
              ))}
              <label className="am-lift relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border" title={t("settings.company.colorCustom")}>
                <span className="text-lg leading-none text-foreground/50">+</span>
                <input type="color" value={form.accent} onChange={(e) => set({ accent: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t("settings.company.colorCustom")} />
              </label>
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("settings.company.work")} description={t("settings.company.workHint")} icon={<Clock className="size-5" />}>
        <div className="flex flex-col gap-5">
          <Field label={t("settings.company.timezone")} error={fieldErrors.timezone}>
            <NativeSelect value={form.timezone} onChange={(e) => set({ timezone: e.target.value })} className="sm:max-w-sm">
              {zones.map(([z, label]) => (
                <option key={z} value={z}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <div>
            <p className="mb-2 text-[13px] font-semibold text-foreground/75">{t("settings.company.workDays")}</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                const on = form.workDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ workDays: on ? form.workDays.filter((x) => x !== d) : [...form.workDays, d].sort() })}
                    className={cn(
                      "h-10 w-12 rounded-xl text-sm font-semibold transition-colors",
                      on ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-foreground/60 hover:bg-muted/70",
                    )}
                  >
                    {t(`settings.company.days.${d}`)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex flex-col gap-4 border-t border-border pt-4">
            <Switch checked={form.acceptanceEnabled} onChange={(v) => set({ acceptanceEnabled: v })} label={t("settings.company.acceptance")} hint={t("settings.company.acceptanceHint")} />
            <Switch checked={form.employeeSeesColleagues} onChange={(v) => set({ employeeSeesColleagues: v })} label={t("settings.company.colleagues")} hint={t("settings.company.colleaguesHint")} />
          </div>
        </div>
      </Section>

      <div className="sticky bottom-20 z-10 flex justify-end md:bottom-4">
        <Button type="submit" size="lg" disabled={pending || !dirty} className="shadow-lg">
          {pending ? <Spinner /> : null}
          {t("settings.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
