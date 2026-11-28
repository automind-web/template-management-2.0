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
      <PageHeader title={director ? t("settings.title") : t("nav.team")} />
      <PageBody className="flex max-w-5xl flex-col gap-5">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label={t("settings.title")} className="flex gap-1 overflow-x-auto border-b border-border">
            {tabs.map(({ key, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => select(key)}
                className={cn(
                  "-mb-px flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-[15px] font-semibold transition-colors",
                  tab === key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden className={cn("size-[18px]", tab === key ? "text-primary" : "")} strokeWidth={1.9} />
                {t(`settings.tabs.${key}`)}
              </button>
            ))}
          </div>
        ) : null}
        <div role="tabpanel" key={tab} className="page-in">
          {tab === "company" ? <CompanyTab /> : tab === "branches" ? <BranchesTab /> : tab === "assistant" ? <AssistantTab /> : <TeamTab />}
        </div>
      </PageBody>
    </>
  );
}
