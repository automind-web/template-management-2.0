"use client";

import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { Button } from "@/components/ui/button";
import { Alert, Section, Spinner, StateDot } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { errorText, t } from "@/lib/i18n";

/** Привязка номера: код из профиля отправляется со своего WhatsApp на рабочий номер компании. */
export function WhatsappSection() {
  const { me, refreshMe } = useCabinet();
  const [code, setCode] = React.useState<{ code: string; expiresAt: number; workNumber: string | null } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const issue = async () => {
    setBusy(true);
    setError(null);
    try {
      setCode(await api("POST", "/api/me/phone/code", {}));
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : "network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="WhatsApp">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StateDot ok={me.user.phoneLinked}>
          {me.user.phoneLinked ? t("profile.phoneLinked", { phone: me.user.phoneMasked ?? "" }) : t("profile.phoneNotLinked")}
        </StateDot>
        {me.user.phoneLinked ? (
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await api("DELETE", "/api/me/phone").catch(() => null);
              await refreshMe();
              setBusy(false);
            }}
          >
            {t("profile.unlinkPhone")}
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => void issue()}>
            {busy ? <Spinner /> : null}
            {t("profile.linkPhone")}
          </Button>
        )}
      </div>
      {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      <Dialog open={Boolean(code)} onOpenChange={(o) => !o && setCode(null)}>
        {code ? (
          <DialogContent
            title={t("profile.linkTitle")}
            footer={
              <Button
                onClick={async () => {
                  const fresh = await refreshMe();
                  if (fresh?.user.phoneLinked) setCode(null);
                  else setError(t("profile.linkWaiting"));
                }}
              >
                {t("profile.linkCheck")}
              </Button>
            }
          >
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px]">
              <li>
                {code.workNumber ? t("profile.linkStep1", { phone: `+${code.workNumber}` }) : t("profile.linkStep1NoNumber")}
              </li>
              <li>
                {t("profile.linkStep2")} <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xl font-bold tracking-widest">{code.code}</span>
              </li>
              <li>{t("profile.linkStep3")}</li>
            </ol>
            <p className="mt-3 text-sm text-muted-foreground">{t("profile.linkExpires", { date: formatShortDateTime(code.expiresAt, me.company.timezone) })}</p>
            {code.workNumber ? (
              <a
                href={`https://wa.me/${code.workNumber}?text=${encodeURIComponent(code.code)}`}
                target="_blank"
                rel="noopener"
                className="mt-3 inline-block font-semibold text-primary hover:underline"
              >
                {t("profile.linkOpenWa")}
              </a>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </Section>
  );
}
