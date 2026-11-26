"use client";

import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState } from "@/components/cabinet/page-header";
import { CopyField } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loading, useLoad } from "./common";

type Member = {
  userId: string;
  login?: string;
  displayName: string;
  role: "employee" | "manager" | "director";
  branchId: string | null;
  branchName: string | null;
  phoneLinked: boolean;
  canInvite: boolean;
  active: boolean;
  self: boolean;
};

export function MembersTab() {
  const { me } = useCabinet();
  const { data, error, load, setData } = useLoad<{ members: Member[] }>("/api/members?branch=all");
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [resetLink, setResetLink] = React.useState<{ name: string; url: string; expiresAt: number } | null>(null);
  const [revoking, setRevoking] = React.useState<Member | null>(null);
  const director = me.capabilities.manageMembers;

  if (!data) return <Loading error={error} onRetry={load} />;
  if (data.members.length === 0) {
    return (
      <Card>
        <EmptyState title={t("settings.members.empty")} />
      </Card>
    );
  }

  /** Изменение сохраняется сразу; ответ сервера — источник истины. */
  const update = async (m: Member, patch: Partial<Pick<Member, "role" | "branchId" | "canInvite" | "active">>) => {
    setActionError(null);
    setData({ members: data.members.map((x) => (x.userId === m.userId ? { ...x, ...patch } : x)) });
    try {
      await api("PATCH", `/api/members/${m.userId}`, patch);
    } catch (e) {
      setActionError(errorText(e instanceof ApiError ? e.code : "network"));
    }
    load();
  };

  const issueReset = async (m: Member) => {
    setActionError(null);
    try {
      const r = await api<{ resetUrl: string; expiresAt: number }>("POST", `/api/members/${m.userId}/reset-link`, {});
      setResetLink({ name: m.displayName, url: r.resetUrl, expiresAt: r.expiresAt });
    } catch (e) {
      setActionError(errorText(e instanceof ApiError ? e.code : "network"));
    }
  };

  const canReset = (m: Member) => !m.self && m.role !== "director" && m.active && (director || m.role === "employee");

  return (
    <div className="flex flex-col gap-3">
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[15px]">
          <thead className="bg-muted/60 text-left text-sm font-semibold text-muted-foreground">
            <tr>
              <th className="w-[24%] px-4 py-3">{t("settings.members.member")}</th>
              <th className="px-3 py-3">{t("settings.members.role")}</th>
              <th className="px-3 py-3">{t("settings.members.branch")}</th>
              <th className="px-3 py-3 text-center">WhatsApp</th>
              <th className="px-3 py-3 text-right">{t("settings.members.access")}</th>
              <th className="px-4 py-3">
                <span className="sr-only">{t("settings.members.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => {
              const editable = director && !m.self && m.role !== "director";
              return (
                <tr key={m.userId} className={cn("border-t border-border", !m.active && "bg-muted/30")}>
                  <td className="px-4 py-3">
                    <p className="font-semibold">{m.displayName}</p>
                    {m.login ? <p className="break-all text-sm text-muted-foreground">{m.login}</p> : null}
                  </td>
                  <td className="px-3 py-3">
                    {editable ? (
                      <NativeSelect
                        aria-label={`${t("settings.members.role")}: ${m.displayName}`}
                        value={m.role}
                        onChange={(e) => void update(m, { role: e.target.value as Member["role"] })}
                        className="min-w-40"
                      >
                        <option value="manager">{t("roles.manager")}</option>
                        <option value="employee">{t("roles.employee")}</option>
                      </NativeSelect>
                    ) : (
                      t(`roles.${m.role}`)
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {editable ? (
                      <NativeSelect
                        aria-label={`${t("settings.members.branch")}: ${m.displayName}`}
                        value={m.branchId ?? ""}
                        onChange={(e) => void update(m, { branchId: e.target.value })}
                        className="min-w-40"
                      >
                        {me.branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      (m.branchName ?? "—")
                    )}
                  </td>
                  <td className="px-3 py-3 text-center">{m.phoneLinked ? "✓" : "—"}</td>
                  <td className="px-3 py-3">
                    {editable ? (
                      <div className="flex flex-col items-end gap-1.5">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="size-[18px] accent-[var(--am-accent)]"
                            checked={m.active}
                            onChange={(e) => (e.target.checked ? void update(m, { active: true }) : setRevoking(m))}
                          />
                          {t("settings.members.active")}
                        </label>
                        {m.role === "manager" ? (
                          <label className="inline-flex cursor-pointer items-center gap-2 whitespace-nowrap">
                            <input
                              type="checkbox"
                              className="size-[18px] accent-[var(--am-accent)]"
                              checked={m.canInvite}
                              disabled={!m.active}
                              onChange={(e) => void update(m, { canInvite: e.target.checked })}
                            />
                            {t("settings.members.canInvite")}
                          </label>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-right">{m.active ? t("settings.members.active") : t("settings.members.revoked")}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canReset(m) ? (
                      <Button variant="outline" size="sm" onClick={() => void issueReset(m)}>
                        {t("settings.members.reset")}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Dialog open={Boolean(resetLink)} onOpenChange={(o) => !o && setResetLink(null)}>
        {resetLink ? (
          <DialogContent title={t("settings.members.resetTitle", { name: resetLink.name })}>
            <p className="mb-3 text-sm text-muted-foreground">
              {t("settings.members.resetHint", { date: formatShortDateTime(resetLink.expiresAt, me.company.timezone) })}
            </p>
            <CopyField value={resetLink.url} />
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        {revoking ? (
          <DialogContent
            title={t("settings.members.revokeTitle")}
            description={t("settings.members.revokeConfirm", { name: revoking.displayName })}
            footer={
              <>
                <Button variant="outline" onClick={() => setRevoking(null)}>
                  {t("app.cancel")}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    const m = revoking;
                    setRevoking(null);
                    void update(m, { active: false });
                  }}
                >
                  {t("settings.members.revokeTitle")}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted-foreground">{t("settings.members.revokeNote")}</p>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
