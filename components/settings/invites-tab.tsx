"use client";

import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState } from "@/components/cabinet/page-header";
import { CopyField, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { errorText, t } from "@/lib/i18n";
import { Loading, useLoad } from "./common";

type Invite = {
  id: string;
  kind: "owner" | "member";
  role: "employee" | "manager" | "director";
  branchName: string | null;
  note: string | null;
  state: "active" | "used" | "revoked" | "expired";
  expiresAt: number;
  usedBy: string | null;
};

export function InvitesTab() {
  const { me, concreteBranchId } = useCabinet();
  const { data, error, load } = useLoad<{ invites: Invite[] }>("/api/invites");
  const [role, setRole] = React.useState<"employee" | "manager">("employee");
  const [branchId, setBranch] = React.useState(concreteBranchId ?? me.branch?.id ?? "");
  const [note, setNote] = React.useState("");
  const [ttl, setTtl] = React.useState(String(companyConfig.invitations.memberTtlHours));
  const [created, setCreated] = React.useState<{ inviteUrl: string; expiresAt: number } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const director = me.capabilities.manageCompany;
  const tz = me.company.timezone;

  const { run, pending, error: formError, fieldErrors } = useSubmit(async () => {
    const r = await api<{ inviteUrl: string; expiresAt: number }>("POST", "/api/invites", {
      role,
      branchId: director ? branchId : me.branch?.id,
      note: note.trim() || null,
      ttlHours: Number(ttl) || undefined,
    });
    setCreated(r);
    setNote("");
    load();
  });

  // Показываются действующие и использованные; отозванные и истёкшие скрыты.
  const visible = data?.invites.filter((i) => i.state === "active" || i.state === "used") ?? [];

  if (me.branches.length === 0) {
    return (
      <Card>
        <EmptyState title={t("branch.none")} text={t("branch.createHint")} />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setCreated(null);
            void run();
          }}
        >
          <h2 className="text-[17px] font-bold">{t("settings.invites.new")}</h2>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.invites.role")} error={fieldErrors.role}>
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value as "employee" | "manager")}>
                <option value="employee">{t("roles.employee")}</option>
                {me.capabilities.inviteManagers ? <option value="manager">{t("roles.manager")}</option> : null}
              </NativeSelect>
            </Field>
            {director ? (
              <Field label={t("settings.invites.branch")} error={fieldErrors.branchId}>
                <NativeSelect value={branchId} onChange={(e) => setBranch(e.target.value)} required>
                  <option value="" disabled>
                    {t("tasks.form.choose")}
                  </option>
                  {me.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field label={t("settings.invites.note")} error={fieldErrors.note}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
            </Field>
            <Field label={t("settings.invites.ttl")} error={fieldErrors.ttlHours}>
              <Input type="number" min={1} max={720} value={ttl} onChange={(e) => setTtl(e.target.value)} required />
            </Field>
          </div>
          <div>
            <Button type="submit" disabled={pending || (director && !branchId)}>
              {pending ? <Spinner /> : null}
              {t("settings.invites.create")}
            </Button>
          </div>
          {created ? (
            <div className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-selected/50 p-3">
              <p className="text-sm font-semibold">{t("settings.invites.linkHint", { date: formatShortDateTime(created.expiresAt, tz) })}</p>
              <CopyField value={created.inviteUrl} />
            </div>
          ) : null}
        </form>
      </Card>

      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
      {!data ? (
        <Loading error={error} onRetry={load} />
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState title={t("settings.invites.empty")} />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {visible.map((inv) => (
            <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="min-w-0">
                <p className="break-words text-[15px]">
                  <span className="font-bold">{t(`roles.${inv.role}`)}</span>
                  {[inv.branchName, inv.note].filter(Boolean).map((x) => ` · ${x}`)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {inv.state === "active"
                    ? t("settings.invites.until", { date: formatShortDateTime(inv.expiresAt, tz) })
                    : `${t("settings.invites.state.used")} · ${inv.usedBy ?? ""}`}
                </p>
              </div>
              {inv.state === "active" && inv.kind === "member" ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={async () => {
                    setActionError(null);
                    try {
                      await api("DELETE", `/api/invites/${inv.id}`);
                    } catch (e) {
                      setActionError(errorText(e instanceof ApiError ? e.code : "network"));
                    }
                    load();
                  }}
                >
                  {t("settings.invites.revoke")}
                </Button>
              ) : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
