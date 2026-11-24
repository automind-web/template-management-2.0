"use client";

import { Plus } from "lucide-react";
import { Tabs } from "radix-ui";
import * as React from "react";
import { BranchDialog } from "@/components/cabinet/branch-dialog";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState, PageHeader } from "@/components/cabinet/page-header";
import { CopyField, LoadError, useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { api } from "@/lib/api";
import { errorText, formatDateTime, t } from "@/lib/i18n";

type Branch = { id: string; name: string; archived: boolean; members: number };
type Member = {
  userId: string;
  login?: string;
  displayName: string;
  role: "employee" | "manager" | "director";
  position: string | null;
  branchId: string | null;
  branchName: string | null;
  phoneLinked: boolean;
  self: boolean;
};
type Invite = {
  id: string;
  role: "employee" | "manager";
  branchId: string | null;
  branchName: string | null;
  note: string | null;
  state: "active" | "used" | "revoked" | "expired";
  expiresAt: number;
  createdAt: number;
  createdBy: string | null;
  usedBy: string | null;
};

/** Загрузка списка с состояниями «загрузка / ошибка с повтором». */
function useList<T>(path: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [failed, setFailed] = React.useState(false);
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    const id = ++seq.current;
    setFailed(false);
    api<T>("GET", path)
      .then((r) => id === seq.current && setData(r))
      .catch(() => id === seq.current && setFailed(true));
  }, [path]);
  React.useEffect(load, [load]);
  return { data, failed, load };
}

export default function SettingsPage() {
  const { me } = useCabinet();
  if (!me.capabilities.viewSystemSettings) {
    return (
      <>
        <PageHeader title={t("settings.title")} />
        <Alert tone="danger">{errorText("forbidden")}</Alert>
      </>
    );
  }
  const tabs = [
    me.capabilities.manageCompany && { key: "company", label: t("settings.tabs.company") },
    me.capabilities.manageBranches && { key: "branches", label: t("settings.tabs.branches") },
    { key: "members", label: t("settings.tabs.members") },
    me.capabilities.inviteEmployees && { key: "invites", label: t("settings.tabs.invites") },
    { key: "connections", label: t("settings.tabs.connections") },
  ].filter(Boolean) as { key: string; label: string }[];

  return (
    <>
      <PageHeader title={t("settings.title")} />
      <Tabs.Root defaultValue={tabs[0]!.key}>
        <Tabs.List className="mb-4 flex gap-1 overflow-x-auto border-b border-border" aria-label={t("settings.title")}>
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.key}
              value={tab.key}
              className="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-foreground"
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="company">
          <CompanyTab />
        </Tabs.Content>
        <Tabs.Content value="branches">
          <BranchesTab />
        </Tabs.Content>
        <Tabs.Content value="members">
          <MembersTab />
        </Tabs.Content>
        <Tabs.Content value="invites">
          <InvitesTab />
        </Tabs.Content>
        <Tabs.Content value="connections">
          <ConnectionsTab />
        </Tabs.Content>
      </Tabs.Root>
    </>
  );
}

// ---------- Компания ----------

function CompanyTab() {
  const { me, refreshMe } = useCabinet();
  const [name, setName] = React.useState(me.company.name);
  const [timezone, setTimezone] = React.useState(me.company.timezone);
  const [saved, setSaved] = React.useState(false);
  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", "/api/company", { name, timezone });
    await refreshMe();
    setSaved(true);
  });
  return (
    <Card className="max-w-xl">
      <CardContent className="pt-4 sm:pt-6">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {saved ? <Alert tone="success">{t("profile.saved")}</Alert> : null}
          <Field label={t("settings.companyName")} error={fieldErrors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </Field>
          <Field label={t("settings.timezone")} error={fieldErrors.timezone}>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} required />
          </Field>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("app.save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------- Филиалы ----------

function BranchesTab() {
  const { refreshMe, setBranchId, me } = useCabinet();
  const { data, failed, load } = useList<{ branches: Branch[] }>("/api/branches");
  const [dialog, setDialog] = React.useState<{ open: boolean; branch: Branch | null }>({ open: false, branch: null });
  const [actionError, setActionError] = React.useState<string | null>(null);

  const after = async (created?: { id: string }) => {
    load();
    const fresh = await refreshMe();
    if (created && fresh && me.branches.length === 0) setBranchId(created.id);
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setDialog({ open: true, branch: null })}>
          <Plus />
          {t("branch.create")}
        </Button>
      </div>
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
      {failed ? (
        <LoadError onRetry={load} />
      ) : !data ? (
        <Spinner />
      ) : data.branches.length === 0 ? (
        <EmptyState title={t("branch.none")} text={t("branch.createHint")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.branches.map((b) => (
            <li key={b.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{t("branch.members", { n: b.members })}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDialog({ open: true, branch: b })}>
                    {t("branch.rename")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      setActionError(null);
                      try {
                        await api("DELETE", `/api/branches/${b.id}`);
                        await after();
                      } catch (e) {
                        setActionError(errorText((e as { code?: string }).code));
                      }
                    }}
                  >
                    {t("branch.archive")}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <BranchDialog
        open={dialog.open}
        branch={dialog.branch}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={(b) => void after(dialog.branch ? undefined : b)}
      />
    </div>
  );
}

// ---------- Участники ----------

function MembersTab() {
  const { me } = useCabinet();
  const { data, failed, load } = useList<{ members: Member[] }>("/api/members?branch=all");
  const [editing, setEditing] = React.useState<Member | null>(null);
  const [revoking, setRevoking] = React.useState<Member | null>(null);
  const [resetCode, setResetCode] = React.useState<{ name: string; code: string; expiresAt: number } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  if (failed) return <LoadError onRetry={load} />;
  if (!data) return <Spinner />;
  if (data.members.length === 0) return <EmptyState title={t("settings.members.empty")} />;

  return (
    <div className="flex flex-col gap-3">
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
      <ul className="flex flex-col gap-2">
        {data.members.map((m) => {
          const manageable = me.capabilities.manageMembers && !m.self && m.role !== "director";
          return (
            <li key={m.userId}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="break-words font-medium">
                    {m.displayName} {m.self ? <Badge tone="accent">{t("settings.members.you")}</Badge> : null}
                  </p>
                  <p className="break-words text-xs text-muted-foreground">
                    {[m.login, t(`roles.${m.role}`), m.branchName, m.position].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {manageable ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => setEditing(m)}>
                      {t("app.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        setActionError(null);
                        try {
                          const r = await api<{ code: string; expiresAt: number }>("POST", `/api/members/${m.userId}/reset-code`, {});
                          setResetCode({ name: m.displayName, ...r });
                        } catch (e) {
                          setActionError(errorText((e as { code?: string }).code));
                        }
                      }}
                    >
                      {t("settings.members.resetCode")}
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => setRevoking(m)}>
                      {t("settings.members.revoke")}
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ul>

      <MemberDialog member={editing} onClose={() => setEditing(null)} onSaved={load} />

      <Dialog open={Boolean(revoking)} onOpenChange={(o) => !o && setRevoking(null)}>
        {revoking ? (
          <DialogContent title={t("settings.members.revoke")} description={t("settings.members.revokeConfirm", { name: revoking.displayName })}>
            <RevokeConfirm
              member={revoking}
              onDone={() => {
                setRevoking(null);
                load();
              }}
              onCancel={() => setRevoking(null)}
            />
          </DialogContent>
        ) : null}
      </Dialog>

      <Dialog open={Boolean(resetCode)} onOpenChange={(o) => !o && setResetCode(null)}>
        {resetCode ? (
          <DialogContent title={`${t("settings.members.resetCodeTitle")}: ${resetCode.name}`}>
            <p className="mb-3 text-sm text-muted-foreground">
              {t("settings.members.resetCodeHint", { date: formatDateTime(resetCode.expiresAt) })}
            </p>
            <CopyField value={resetCode.code} />
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function RevokeConfirm({ member, onDone, onCancel }: { member: Member; onDone: () => void; onCancel: () => void }) {
  const { run, pending, error } = useSubmit(async () => {
    await api("DELETE", `/api/members/${member.userId}`);
    onDone();
  });
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          {t("app.cancel")}
        </Button>
        <Button variant="destructive" disabled={pending} onClick={() => void run()}>
          {pending ? <Spinner /> : null}
          {t("settings.members.revoke")}
        </Button>
      </div>
    </div>
  );
}

function MemberDialog({ member, onClose, onSaved }: { member: Member | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useCabinet();
  const [role, setRole] = React.useState<"employee" | "manager">("employee");
  const [branchId, setBranch] = React.useState("");
  const [position, setPosition] = React.useState("");
  React.useEffect(() => {
    if (member) {
      setRole(member.role === "manager" ? "manager" : "employee");
      setBranch(member.branchId ?? me.branches[0]?.id ?? "");
      setPosition(member.position ?? "");
    }
  }, [member, me.branches]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    await api("PATCH", `/api/members/${member!.userId}`, { role, branchId, position: position.trim() || null });
    onSaved();
    onClose();
  });

  return (
    <Dialog open={Boolean(member)} onOpenChange={(o) => !o && onClose()}>
      {member ? (
        <DialogContent title={`${t("settings.members.transfer")}: ${member.displayName}`}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label={t("settings.members.role")} error={fieldErrors.role}>
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value as "employee" | "manager")}>
                <option value="employee">{t("roles.employee")}</option>
                <option value="manager">{t("roles.manager")}</option>
              </NativeSelect>
            </Field>
            <Field label={t("settings.members.branch")} error={fieldErrors.branchId}>
              <NativeSelect value={branchId} onChange={(e) => setBranch(e.target.value)}>
                {me.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("settings.members.position")} error={fieldErrors.position}>
              <Input value={position} onChange={(e) => setPosition(e.target.value)} maxLength={120} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                {t("app.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Spinner /> : null}
                {t("app.save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

// ---------- Приглашения ----------

function InvitesTab() {
  const { me, branchId: currentBranch } = useCabinet();
  const { data, failed, load } = useList<{ invites: Invite[] }>("/api/invites");
  const [role, setRole] = React.useState<"employee" | "manager">("employee");
  const [branchId, setBranch] = React.useState(currentBranch ?? me.branches[0]?.id ?? "");
  const [note, setNote] = React.useState("");
  const [created, setCreated] = React.useState<{ inviteUrl: string; expiresAt: number } | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!branchId && me.branches[0]) setBranch(me.branches[0].id);
  }, [branchId, me.branches]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const r = await api<{ inviteUrl: string; expiresAt: number }>("POST", "/api/invites", {
      role,
      branchId,
      note: note.trim() || null,
    });
    setCreated(r);
    setNote("");
    load();
  });

  if (me.branches.length === 0) return <EmptyState title={t("branch.none")} text={t("branch.createHint")} />;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.invites.create")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setCreated(null);
              void run();
            }}
          >
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <Field label={t("settings.invites.role")} error={fieldErrors.role}>
              <NativeSelect value={role} onChange={(e) => setRole(e.target.value as "employee" | "manager")}>
                <option value="employee">{t("roles.employee")}</option>
                {me.capabilities.inviteManagers ? <option value="manager">{t("roles.manager")}</option> : null}
              </NativeSelect>
            </Field>
            <Field label={t("settings.invites.branch")} error={fieldErrors.branchId}>
              <NativeSelect value={branchId} onChange={(e) => setBranch(e.target.value)} disabled={me.branches.length === 1}>
                {me.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("settings.invites.note")} error={fieldErrors.note}>
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
            <div>
              <Button type="submit" disabled={pending || !branchId}>
                {pending ? <Spinner /> : <Plus />}
                {t("settings.invites.create")}
              </Button>
            </div>
            {created ? (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="text-sm font-medium">{t("settings.invites.linkTitle")}</p>
                <p className="text-xs text-muted-foreground">
                  {t("settings.invites.linkHint", { date: formatDateTime(created.expiresAt) })}
                </p>
                <CopyField value={created.inviteUrl} />
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
        {failed ? (
          <LoadError onRetry={load} />
        ) : !data ? (
          <Spinner />
        ) : data.invites.length === 0 ? (
          <EmptyState title={t("settings.invites.empty")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {data.invites.map((inv) => (
              <li key={inv.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 text-sm">
                    <p className="break-words font-medium">
                      {t(`roles.${inv.role}`)} · {inv.branchName}
                      {inv.note ? ` · ${inv.note}` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <Badge tone={inv.state === "active" ? "accent" : inv.state === "used" ? "success" : "neutral"}>
                        {t(`settings.invites.state.${inv.state}`)}
                      </Badge>{" "}
                      {inv.state === "used" && inv.usedBy
                        ? t("settings.invites.usedBy", { name: inv.usedBy })
                        : t("invite.expires", { date: formatDateTime(inv.expiresAt) })}
                    </p>
                  </div>
                  {inv.state === "active" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        setActionError(null);
                        try {
                          await api("DELETE", `/api/invites/${inv.id}`);
                          load();
                        } catch (e) {
                          setActionError(errorText((e as { code?: string }).code));
                        }
                      }}
                    >
                      {t("settings.invites.revoke")}
                    </Button>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- Подключения ----------

type Connection = { configured: boolean; state: string; recovery: string };
type SystemStatus = {
  build: string;
  schema: string;
  bindings: { db: boolean; bucket: boolean };
  connections?: Record<"whapi" | "openai" | "push" | "files", Connection>;
};

function ConnectionsTab() {
  const { data, failed, load } = useList<SystemStatus>("/api/system/status");
  if (failed) return <LoadError onRetry={load} />;
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("settings.connections.build")}</dt>
            <dd className="font-mono">{data.build}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("settings.connections.schema")}</dt>
            <dd className="font-mono">{data.schema}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("settings.connections.db")}</dt>
            <dd>{data.bindings.db ? t("settings.connections.states.ok") : t("settings.connections.states.down")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("settings.connections.bucket")}</dt>
            <dd>{data.bindings.bucket ? t("settings.connections.states.ok") : t("settings.connections.states.missing_binding")}</dd>
          </div>
        </dl>
      </Card>
      {data.connections ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {(Object.entries(data.connections) as [keyof NonNullable<SystemStatus["connections"]>, Connection][]).map(([key, c]) => (
            <li key={key}>
              <Card className="flex h-full flex-col gap-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{t(`settings.connections.${key}`)}</p>
                  <Badge tone={c.state === "ready" ? "success" : c.configured ? "warning" : "danger"}>
                    {t(`settings.connections.states.${c.state}`)}
                  </Badge>
                </div>
                {c.state !== "ready" ? (
                  <p className="text-xs text-muted-foreground">{t(`settings.connections.recovery.${c.recovery}`)}</p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
