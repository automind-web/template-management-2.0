"use client";

import { EmptyState, PageHeader } from "@/components/cabinet/page-header";
import { t } from "@/lib/i18n";

export default function Page() {
  return (
    <>
      <PageHeader title={t("nav.stats")} />
      <EmptyState title={t("app.soon")} text={t("placeholder.stats")} />
    </>
  );
}
