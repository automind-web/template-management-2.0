"use client";

import { Building2, Bot, Store, Users } from "lucide-react";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { AssistantTab } from "@/components/settings/assistant-tab";
import { BranchesTab } from "@/components/settings/branches-tab";
import { CompanyTab } from "@/components/settings/company-tab";
import { TeamTab } from "@/components/settings/team-tab";
import { Alert } from "@/components/ui/card";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "company", icon: Building2 },
  { key: "branches", icon: Store },
  { key: "team", icon: Users },
  { key: "assistant", icon: Bot },
] as const;

/** Директор: компания, филиалы, сотрудники, WhatsApp и помощник. Руководитель: сотрудники своего филиала. */
export default function SettingsPage() {
  const { me } = useCabinet();
  const director = me.capabilities.viewSystemSettings;
  const tabs = director ? TABS : TABS.filter((tab) => tab.key === "team");
  const [tab, setTab] = React.useState<string>(tabs[0]!.key);

  React.useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (fromUrl && tabs.some((x) => x.key === fromUrl)) setTab(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (value: string) => {
    setTab(value);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?tab=${value}`);
  };

  if (!me.capabilities.manageTeam) {
    return (
      <>
        <PageHeader title={t("settings.title")} />
        <PageBody>
          <Alert tone="danger">{errorText("forbidden")}</Alert>
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader title={director ? t("settings.title") : t("nav.team")} subtitle={director ? t("settings.subtitle") : t("team.subtitle")} />
      <PageBody className="flex max-w-5xl flex-col gap-5">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label={t("settings.title")} className="grid grid-cols-4 gap-1 rounded-2xl bg-muted/80 p-1">
            {tabs.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => select(key)}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-xs font-semibold transition-all sm:flex-row sm:gap-2 sm:px-4 sm:py-2.5 sm:text-[15px]",
                  tab === key ? "bg-surface text-foreground shadow-sm" : "text-foreground/60 hover:text-foreground",
                )}
              >
                <Icon className="size-[18px]" />
                <span className="max-w-full truncate">{t(`settings.tabs.${key}`)}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div role="tabpanel" key={tab} className="am-fade-up">
          {tab === "company" ? <CompanyTab /> : tab === "branches" ? <BranchesTab /> : tab === "assistant" ? <AssistantTab /> : <TeamTab />}
        </div>
      </PageBody>
    </>
  );
}
