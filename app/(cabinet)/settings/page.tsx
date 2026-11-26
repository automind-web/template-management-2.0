"use client";

import { Tabs } from "radix-ui";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { BranchesTab } from "@/components/settings/branches-tab";
import { CompanyTab } from "@/components/settings/company-tab";
import { ConnectionsTab } from "@/components/settings/connections-tab";
import { InvitesTab } from "@/components/settings/invites-tab";
import { MembersTab } from "@/components/settings/members-tab";
import { ProcessTab } from "@/components/settings/process-tab";
import { Alert } from "@/components/ui/card";
import { errorText, t } from "@/lib/i18n";

/** Директор: компания, процесс, филиалы, участники, приглашения, подключения. Руководитель: участники и приглашения филиала. */
export default function SettingsPage() {
  const { me } = useCabinet();
  const director = me.capabilities.manageCompany;
  const tabs = director
    ? (["company", "process", "branches", "members", "invites", "connections"] as const)
    : me.capabilities.inviteEmployees
      ? (["members", "invites"] as const)
      : (["members"] as const);
  const [tab, setTab] = React.useState<string>(tabs[0]);

  React.useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    if (fromUrl && (tabs as readonly string[]).includes(fromUrl)) setTab(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (value: string) => {
    setTab(value);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?tab=${value}`);
  };

  if (!me.capabilities.viewSystemSettings) {
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
      <PageHeader title={t("settings.title")} />
      <PageBody className="max-w-6xl">
        <Tabs.Root value={tab} onValueChange={select}>
          <Tabs.List className="mb-5 flex gap-1 overflow-x-auto border-b border-border" aria-label={t("settings.title")}>
            {tabs.map((key) => (
              <Tabs.Trigger
                key={key}
                value={key}
                className="-mb-px whitespace-nowrap border-b-2 border-transparent px-4 py-2.5 text-[15px] font-semibold text-foreground/60 hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground"
              >
                {t(`settings.tabs.${key}`)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {director ? (
            <>
              <Tabs.Content value="company">
                <CompanyTab />
              </Tabs.Content>
              <Tabs.Content value="process">
                <ProcessTab />
              </Tabs.Content>
              <Tabs.Content value="branches">
                <BranchesTab />
              </Tabs.Content>
              <Tabs.Content value="connections">
                <ConnectionsTab />
              </Tabs.Content>
            </>
          ) : null}
          <Tabs.Content value="members">
            <MembersTab />
          </Tabs.Content>
          <Tabs.Content value="invites">
            <InvitesTab />
          </Tabs.Content>
        </Tabs.Root>
      </PageBody>
    </>
  );
}
