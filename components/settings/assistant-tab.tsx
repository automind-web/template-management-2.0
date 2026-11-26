"use client";

import { Bot, Check, KeyRound, MessageCircle, Sparkles, Users } from "lucide-react";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Card, Section, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loading, useLoad } from "./common";

type Settings = {
  whatsapp: { set: boolean; last4: string; status: string; number: string };
  openai: { set: boolean; last4: string; status: string };
  model: string;
  assistantName: string;
  instructions: string;
  employeesWithPhone: number;
};

const MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"] as const;

export function AssistantTab() {
  const { data, error, load, setData } = useLoad<Settings>("/api/settings/assistant");
  if (!data) return <Loading error={error} onRetry={load} />;
  return <AssistantForm data={data} onSaved={setData} />;
}

/** Ключ: сохранённый показывается как «••••1234» с кнопками «Заменить» и «Отключить». */
type KeyState = { mode: "keep" } | { mode: "edit"; value: string } | { mode: "remove" };

function KeyField({
  label,
  hint,
  saved,
  last4,
  state,
  onChange,
  error,
  placeholder,
}: {
  label: string;
  hint: string;
  saved: boolean;
  last4: string;
  state: KeyState;
  onChange: (s: KeyState) => void;
  error?: string;
  placeholder: string;
}) {
  if (saved && state.mode === "keep") {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-semibold text-foreground/75">{label}</p>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2">
          <KeyRound className="size-4 text-foreground/50" />
          <span className="flex-1 font-mono text-sm tracking-wider">••••••••{last4}</span>
          <Button variant="ghost" size="sm" onClick={() => onChange({ mode: "edit", value: "" })}>
            {t("assistantSettings.replace")}
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onChange({ mode: "remove" })}>
            {t("assistantSettings.disconnect")}
          </Button>
        </div>
      </div>
    );
  }
  if (state.mode === "remove") {
    return (
      <Alert tone="neutral" className="flex items-center justify-between gap-3">
        <span>{t("assistantSettings.willDisconnect")}</span>
        <Button variant="outline" size="sm" onClick={() => onChange({ mode: "keep" })}>
          {t("app.cancel")}
        </Button>
      </Alert>
    );
  }
  return (
    <Field label={label} hint={hint} error={error}>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={state.mode === "edit" ? state.value : ""}
        onChange={(e) => onChange({ mode: "edit", value: e.target.value })}
        placeholder={placeholder}
      />
    </Field>
  );
}

function StatusPill({ status }: { status: string }) {
  const ok = status === "connected";
  const neutral = status === "not_set" || status === "unchecked";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        ok ? "bg-success/10 text-success" : neutral ? "bg-muted text-foreground/55" : "bg-destructive/10 text-destructive",
      )}
    >
      <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : neutral ? "bg-foreground/35" : "bg-destructive")} />
      {t(`assistantSettings.status.${status}`)}
    </span>
  );
}

function AssistantForm({ data, onSaved }: { data: Settings; onSaved: (s: Settings) => void }) {
  const { refreshMe } = useCabinet();
  const toast = useToast();
  const [wa, setWa] = React.useState<KeyState>({ mode: "keep" });
  const [ai, setAi] = React.useState<KeyState>({ mode: "keep" });
  const [number, setNumber] = React.useState(data.whatsapp.number ? `+${data.whatsapp.number}` : "");
  const [model, setModel] = React.useState(data.model);
  const [name, setName] = React.useState(data.assistantName);
  const [instructions, setInstructions] = React.useState(data.instructions);

  const keyValue = (s: KeyState) => (s.mode === "edit" ? (s.value.trim() ? s.value.trim() : undefined) : s.mode === "remove" ? "" : undefined);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const next = await api<Settings>("PATCH", "/api/settings/assistant", {
      whapiKey: keyValue(wa),
      openaiKey: keyValue(ai),
      number,
      model,
      assistantName: name,
      instructions,
    });
    onSaved(next);
    setWa({ mode: "keep" });
    setAi({ mode: "keep" });
    setNumber(next.whatsapp.number ? `+${next.whatsapp.number}` : "");
    await refreshMe();
    toast(t("settings.saved"));
  });

  const steps = [
    { done: data.whatsapp.set && data.whatsapp.status === "connected", label: t("assistantSettings.step1") },
    { done: data.openai.set, label: t("assistantSettings.step2") },
    { done: data.employeesWithPhone > 0, label: t("assistantSettings.step3", { n: data.employeesWithPhone }) },
  ];

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-primary to-[#1b2f86] p-5 text-white">
        <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full bg-white/10 blur-xl" />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl bg-white/15">
              <Bot className="size-6" />
            </span>
            <div>
              <h2 className="text-lg font-bold">{t("assistantSettings.heroTitle")}</h2>
              <p className="text-sm text-white/75">{t("assistantSettings.heroText")}</p>
            </div>
          </div>
          <ol className="grid gap-2 sm:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 text-sm">
                <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold", s.done ? "bg-white text-primary" : "bg-white/20")}>
                  {s.done ? <Check className="size-3.5" /> : i + 1}
                </span>
                {s.label}
              </li>
            ))}
          </ol>
        </div>
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Section
        title={t("assistantSettings.waTitle")}
        description={t("assistantSettings.waText")}
        icon={<MessageCircle className="size-5" />}
        actions={<StatusPill status={data.whatsapp.status} />}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <KeyField
            label={t("assistantSettings.waKey")}
            hint={t("assistantSettings.waKeyHint")}
            saved={data.whatsapp.set}
            last4={data.whatsapp.last4}
            state={wa}
            onChange={setWa}
            error={fieldErrors.whapiKey}
            placeholder={t("assistantSettings.keyPlaceholder")}
          />
          <Field label={t("assistantSettings.waNumber")} hint={t("assistantSettings.waNumberHint")} error={fieldErrors.number}>
            <Input type="tel" inputMode="tel" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="+7 700 000 00 00" />
          </Field>
        </div>
      </Section>

      <Section
        title={t("assistantSettings.aiTitle")}
        description={t("assistantSettings.aiText")}
        icon={<Sparkles className="size-5" />}
        actions={<StatusPill status={data.openai.status} />}
      >
        <div className="flex flex-col gap-5">
          <KeyField
            label={t("assistantSettings.aiKey")}
            hint={t("assistantSettings.aiKeyHint")}
            saved={data.openai.set}
            last4={data.openai.last4}
            state={ai}
            onChange={setAi}
            error={fieldErrors.openaiKey}
            placeholder={t("assistantSettings.keyPlaceholder")}
          />
          <div>
            <p className="mb-2 text-[13px] font-semibold text-foreground/75">{t("assistantSettings.model")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODELS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={model === m}
                  onClick={() => setModel(m)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border-2 p-3 text-left transition-all",
                    model === m ? "border-primary bg-selected/60 shadow-sm" : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", model === m ? "border-primary bg-primary" : "border-foreground/25")}>
                    {model === m ? <Check className="size-3 text-white" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {t(`assistantSettings.models.${m.replaceAll(".", "_")}.name`)}
                      {m === "gpt-4.1-mini" ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{t("assistantSettings.recommended")}</span> : null}
                    </span>
                    <span className="block text-sm text-muted-foreground">{t(`assistantSettings.models.${m.replaceAll(".", "_")}.hint`)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title={t("assistantSettings.behaviorTitle")} description={t("assistantSettings.behaviorText")} icon={<Bot className="size-5" />}>
        <div className="flex flex-col gap-4">
          <Field label={t("assistantSettings.name")} error={fieldErrors.assistantName}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required className="sm:max-w-sm" />
          </Field>
          <Field label={t("assistantSettings.instructions")} hint={t("assistantSettings.instructionsHint")} error={fieldErrors.instructions}>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} rows={5} placeholder={t("assistantSettings.instructionsPlaceholder")} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {(["i1", "i2", "i3"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setInstructions((v) => (v.trim() ? `${v.trim()}\n` : "") + t(`assistantSettings.examples.${k}`))}
                className="rounded-full border border-border px-3 py-1 text-sm text-foreground/70 hover:bg-muted"
              >
                + {t(`assistantSettings.examples.${k}`)}
              </button>
            ))}
          </div>
        </div>
      </Section>

      <Section title={t("assistantSettings.whoTitle")} icon={<Users className="size-5" />}>
        <ul className="flex flex-col gap-2 text-[15px]">
          {(["who1", "who2", "who3"] as const).map((k) => (
            <li key={k} className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-success" />
              {t(`assistantSettings.${k}`)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted-foreground">{t("assistantSettings.whoCount", { n: data.employeesWithPhone })}</p>
      </Section>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex justify-end border-t border-border bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:bottom-0">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner /> : null}
          {t("settings.saveChanges")}
        </Button>
      </div>
    </form>
  );
}
