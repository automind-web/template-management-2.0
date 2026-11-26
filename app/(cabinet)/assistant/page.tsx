"use client";

import { MessageCircle } from "lucide-react";
import { EmptyState, PageBody, PageHeader } from "@/components/cabinet/page-header";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n";

/** Раздел следующего этапа: появится по макету (см. README, «Этапы»). */
export default function Page() {
  return (
    <>
      <PageHeader title={t("nav.assistant")} />
      <PageBody>
        <Card>
          <EmptyState icon={<MessageCircle className="size-6" />} title={t("app.soon")} text={t("placeholder.assistant")} />
        </Card>
      </PageBody>
    </>
  );
}
