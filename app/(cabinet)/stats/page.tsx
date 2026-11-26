"use client";

import { BarChart3 } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@/components/cabinet/page-header";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";

/** Раздел следующего этапа: появится по макету (см. README, «Этапы»). */
export default function Page() {
  return (
    <>
      <PageHeader title={t("nav.stats")} />
      <PageBody>
        <Card>
          <EmptyState icon={<BarChart3 className="size-6" />} title={t("app.soon")} text={t("placeholder.stats")} />
        </Card>
      </PageBody>
    </>
  );
}
