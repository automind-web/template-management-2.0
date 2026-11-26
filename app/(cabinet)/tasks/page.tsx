"use client";

import { Building2, ListTodo, Plus } from "lucide-react";
import * as React from "react";
import { BranchDialog } from "@/components/cabinet/branch-dialog";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState, PageHeader } from "@/components/cabinet/page-header";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export default function TasksPage() {
  const { me, refreshMe, setBranchId } = useCabinet();
  const [creating, setCreating] = React.useState(false);

  if (me.branches.length === 0) {
    return (
      <>
        <PageHeader title={t("tasks.title")} />
        <EmptyState
          icon={<Building2 className="size-8" />}
          title={t("branch.none")}
          text={t("branch.createHint")}
          action={
            me.capabilities.manageBranches ? (
              <Button onClick={() => setCreating(true)}>
                <Plus />
                {t("branch.create")}
              </Button>
            ) : null
          }
        />
        <BranchDialog
          open={creating}
          onOpenChange={setCreating}
          onSaved={async (b) => {
            await refreshMe();
            setBranchId(b.id);
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t("tasks.title")} />
      <EmptyState icon={<ListTodo className="size-8" />} title={t("tasks.emptyTitle")} text={t("tasks.emptyText")} />
    </>
  );
}
