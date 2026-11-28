"use client";

import { Check, ChevronRight, Copy, Crown, KeyRound, Link2, MessageCircle, Search, Send, UserPlus, Users, X } from "lucide-react";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState } from "@/components/cabinet/page-header";
import { useSubmit } from "@/components/forms";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { StatTile } from "@/components/ui/stat-tile";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Loading, useLoad } from "./common";

type Member = {
  userId: string;
  login?: string;
  displayName: string;
  role: "director" | "manager" | "employee";
  position: string | null;
  branchId: string | null;
  branchName: string | null;
  phoneLinked: boolean;
  phone: string | null;
  canInvite: boolean;
  active: boolean;
  self: boolean;
};

type Invite = {
  id: string;
  kind: "owner" | "member";
  role: "employee" | "manager" | "director";
  branchName: string | null;
  note: string | null;
  state: "active" | "used" | "revoked" | "expired";
  expiresAt: number;
};

function formatPhone(p: string) {
  return p.length === 11 ? `+${p[0]} ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7, 9)} ${p.slice(9)}` : `+${p}`;
}

export function TeamTab() {
  const { me } = useCabinet();
  const members = useLoad<{ members: Member[] }>("/api/members?branch=all");
  const invites = useLoad<{ invites: Invite[] }>("/api/invites");
  const [query, setQuery] = React.useState("");
  const [inviting, setInviting] = React.useState(false);
  const [editing, setEditing] = React.useState<Member | null>(null);
  const canInvite = me.capabilities.inviteEmployees || me.capabilities.inviteManagers;
  const director = me.capabilities.manageMembers;

  if (!members.data) return <Loading error={members.error} onRetry={members.load} />;

  if (me.branches.length === 0) {
    return (
      <Card>
        <EmptyState icon={<UserPlus className="size-6" />} title={t("team.noBranches")} text={t("team.noBranchesHint")} />
      </Card>
    );
  }

  const all = members.data.members;
  const q = query.trim().toLocaleLowerCase("ru");
  const list = q ? all.filter((m) => `${m.displayName} ${m.position ?? ""} ${m.branchName ?? ""}`.toLocaleLowerCase("ru").includes(q)) : all;
  const active = list.filter((m) => m.active);
  const inactive = list.filter((m) => !m.active);
  const pending = invites.data?.invites.filter((i) => i.state === "active" && i.kind === "member") ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile index={0} icon={Users} label={t("team.statPeople")} value={all.filter((m) => m.active).length} />
        <StatTile index={1} icon={Crown} tone="warning" label={t("team.statManagers")} value={all.filter((m) => m.active && m.role === "manager").length} />
        <StatTile index={2} icon={MessageCircle} tone="success" label={t("team.statWhatsapp")} value={all.filter((m) => m.active && m.phoneLinked).length} />
        <StatTile index={3} icon={Link2} label={t("team.statInvites")} value={pending.length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/40" />
          <span className="sr-only">{t("team.search")}</span>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("team.search")} className="pl-9" />
        </label>
        {canInvite ? (
          <Button onClick={() => setInviting(true)}>
            <UserPlus />
            {t("team.invite")}
          </Button>
        ) : null}
      </div>

      {pending.length ? <PendingInvites invites={pending} onChanged={invites.load} /> : null}

      <Card className="divide-y divide-border overflow-hidden">
        {active.length === 0 ? <EmptyState title={t("team.empty")} /> : null}
        {active.map((m) => (
          <MemberRow key={m.userId} m={m} onOpen={!m.self && m.role !== "director" ? () => setEditing(m) : undefined} />
        ))}
      </Card>

      {inactive.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="px-1 text-sm font-semibold text-muted-foreground">{t("team.disabled")}</h3>
          <Card className="divide-y divide-border overflow-hidden opacity-75">
            {inactive.map((m) => (
              <MemberRow key={m.userId} m={m} onOpen={() => setEditing(m)} />
            ))}
          </Card>
        </div>
      ) : null}

      <InviteDialog
        open={inviting}
        onOpenChange={setInviting}
        onCreated={() => {
          invites.load();
        }}
      />
      <MemberDialog
        member={editing}
        director={director}
        onClose={() => setEditing(null)}
        onSaved={() => {
          members.load();
        }}
      />
    </div>
  );
}

function MemberRow({ m, onOpen }: { m: Member; onOpen?: () => void }) {
  const body = (
    <>
      <Avatar name={m.displayName} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-semibold">{m.displayName}</span>
          {m.self ? <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground/60">{t("team.you")}</span> : null}
        </span>
        <span className="block truncate text-sm text-muted-foreground">
          {[t(`roles.${m.role}`), m.position, m.branchName].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span
        title={m.phoneLinked ? t("team.waOn") : t("team.waOff")}
        className={cn(
          "hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold sm:flex",
          m.phoneLinked ? "bg-success/10 text-success" : "bg-muted text-foreground/45",
        )}
      >
        <MessageCircle className="size-3.5" />
        {m.phone ? formatPhone(m.phone) : m.phoneLinked ? t("team.waOn") : t("team.waOff")}
      </span>
      {onOpen ? <ChevronRight className="size-5 shrink-0 text-foreground/35" /> : null}
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 px-4 py-3">{body}</div>
  );
}

function PendingInvites({ invites, onChanged }: { invites: Invite[]; onChanged: () => void }) {
  const { me } = useCabinet();
  const toast = useToast();
  return (
    <Card className="border-dashed p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
        <Link2 className="size-4" />
        {t("team.pending")}
      </h3>
      <ul className="flex flex-col gap-2">
        {invites.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2">
            <span className="min-w-0 text-sm">
              <span className="font-semibold">{inv.note || t(`roles.${inv.role}`)}</span>
              <span className="text-muted-foreground">
                {" · "}
                {[inv.note ? t(`roles.${inv.role}`) : null, inv.branchName, t("team.until", { date: formatShortDateTime(inv.expiresAt, me.company.timezone) })]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("team.cancelInvite")}
              title={t("team.cancelInvite")}
              onClick={async () => {
                try {
                  await api("DELETE", `/api/invites/${inv.id}`);
                  toast(t("team.inviteCancelled"));
                  onChanged();
                } catch (e) {
                  toast(errorText(e instanceof ApiError ? e.code : "network"), "danger");
                }
              }}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const TTL = [
  { hours: 24, key: "day" },
  { hours: 72, key: "days3" },
  { hours: 168, key: "week" },
] as const;

function InviteDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  const { me, concreteBranchId } = useCabinet();
  const director = me.capabilities.inviteManagers;
  const [role, setRole] = React.useState<"employee" | "manager">("employee");
  const [branchId, setBranchId] = React.useState("");
  const [name, setName] = React.useState("");
  const [ttl, setTtl] = React.useState(72);
  const [link, setLink] = React.useState<{ url: string; expiresAt: number } | null>(null);

  React.useEffect(() => {
    if (open) {
      setRole("employee");
      setBranchId(concreteBranchId ?? me.branch?.id ?? me.branches[0]?.id ?? "");
      setName("");
      setTtl(72);
      setLink(null);
    }
  }, [open, concreteBranchId, me.branch, me.branches]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const r = await api<{ inviteUrl: string; expiresAt: number }>("POST", "/api/invites", {
      role,
      branchId: director ? branchId : me.branch?.id,
      note: name.trim() || null,
      ttlHours: ttl,
    });
    setLink({ url: r.inviteUrl, expiresAt: r.expiresAt });
    onCreated();
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={link ? t("team.linkReady") : t("team.invite")}
        description={link ? t("team.linkReadyHint", { date: formatShortDateTime(link.expiresAt, me.company.timezone) }) : t("team.inviteHint")}
        footer={
          link ? (
            <Button onClick={() => onOpenChange(false)}>{t("app.done")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("app.cancel")}
              </Button>
              <Button type="submit" form="invite-form" disabled={pending || (director && !branchId)}>
                {pending ? <Spinner /> : <Link2 />}
                {t("team.makeLink")}
              </Button>
            </>
          )
        }
      >
        {link ? (
          <ShareLink url={link.url} name={name} company={me.company.name} />
        ) : (
          <form
            id="invite-form"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
          >
            {error ? <Alert tone="danger">{error}</Alert> : null}
            {director ? (
              <div className="grid grid-cols-2 gap-2">
                {(["employee", "manager"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={role === r}
                    onClick={() => setRole(r)}
                    className={cn(
                      "rounded-xl border-2 p-3 text-left transition-colors",
                      role === r ? "border-primary bg-selected/60" : "border-border hover:bg-muted/60",
                    )}
                  >
                    <span className="block text-[15px] font-semibold">{t(`roles.${r}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`team.roleHint.${r}`)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <Field label={t("team.inviteName")} hint={t("team.inviteNameHint")} error={fieldErrors.note}>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus placeholder={t("team.inviteNamePlaceholder")} />
            </Field>
            {director ? (
              <Field label={t("team.branch")} error={fieldErrors.branchId}>
                <NativeSelect value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
                  {me.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <div>
              <p className="mb-2 text-[13px] font-semibold text-foreground/75">{t("team.ttl")}</p>
              <div className="flex gap-2">
                {TTL.map((o) => (
                  <button
                    key={o.hours}
                    type="button"
                    aria-pressed={ttl === o.hours}
                    onClick={() => setTtl(o.hours)}
                    className={cn(
                      "flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                      ttl === o.hours ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70 hover:bg-muted/70",
                    )}
                  >
                    {t(`team.ttlOptions.${o.key}`)}
                  </button>
                ))}
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Готовая ссылка: скопировать или сразу отправить в WhatsApp. */
function ShareLink({ url, name, company, reset }: { url: string; name: string; company: string; reset?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const text = reset ? t("team.shareResetText", { url }) : t("team.shareText", { name: name.trim() || "", company, url }).replace(/^,\s*/, "");
  return (
    <div className="flex flex-col gap-3">
      <div className="card-in flex items-center gap-3 rounded-xl bg-success/10 p-3 text-success">
        <Check className="size-5 shrink-0" />
        <span className="text-[15px] font-semibold">{reset ? t("team.resetReady") : t("team.linkCreated")}</span>
      </div>
      <div className="break-all rounded-xl border border-border bg-muted/50 px-3 py-2.5 font-mono text-xs">{url}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              /* буфер обмена недоступен — ссылку можно выделить вручную */
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? t("app.copied") : t("app.copy")}
        </Button>
        <Button asChild className="bg-[#1fa855] text-white hover:bg-[#1a9049]">
          <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            <Send />
            {t("team.sendWhatsapp")}
          </a>
        </Button>
      </div>
    </div>
  );
}

function MemberDialog({ member, director, onClose, onSaved }: { member: Member | null; director: boolean; onClose: () => void; onSaved: () => void }) {
  const { me } = useCabinet();
  const toast = useToast();
  const [form, setForm] = React.useState({ role: "employee" as "employee" | "manager", branchId: "", position: "", phone: "", canInvite: false });
  const [reset, setReset] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!member) return;
    setForm({
      role: member.role === "manager" ? "manager" : "employee",
      branchId: member.branchId ?? me.branches[0]?.id ?? "",
      position: member.position ?? "",
      phone: member.phone ? `+${member.phone}` : "",
      canInvite: member.canInvite,
    });
    setReset(null);
  }, [member, me.branches]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    if (!member) return;
    await api("PATCH", `/api/members/${member.userId}`, {
      role: form.role,
      branchId: form.branchId,
      position: form.position.trim() || null,
      phone: form.phone,
      canInvite: form.role === "manager" ? form.canInvite : false,
    });
    toast(t("settings.saved"));
    onClose();
    onSaved();
  });

  const call = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorText(e instanceof ApiError ? e.code : "network"), "danger");
    } finally {
      setBusy(false);
    }
  };

  const toggleAccess = () =>
    call(async () => {
      if (!member) return;
      await api("PATCH", `/api/members/${member.userId}`, { active: !member.active, ...(member.active ? {} : { branchId: form.branchId }) });
      toast(member.active ? t("team.accessClosed") : t("team.accessRestored"));
      onClose();
      onSaved();
    });

  const resetLink = () =>
    call(async () => {
      if (!member) return;
      const r = await api<{ resetUrl: string }>("POST", `/api/members/${member.userId}/reset-link`);
      setReset(r.resetUrl);
    });

  return (
    <Dialog open={Boolean(member)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={member?.displayName ?? ""}
        description={member ? [t(`roles.${member.role}`), member.branchName].filter(Boolean).join(" · ") : undefined}
        footer={
          reset ? (
            <Button onClick={() => setReset(null)}>{t("app.back")}</Button>
          ) : director && member?.active ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("app.cancel")}
              </Button>
              <Button type="submit" form="member-form" disabled={pending}>
                {pending ? <Spinner /> : null}
                {t("app.save")}
              </Button>
            </>
          ) : null
        }
      >
        {!member ? null : reset ? (
          <ShareLink url={reset} name={member.displayName} company={me.company.name} reset />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <Avatar name={member.displayName} size={52} />
              <div className="min-w-0">
                <p className="truncate text-[17px] font-bold">{member.displayName}</p>
                {member.login ? <p className="truncate text-sm text-muted-foreground">{t("team.loginIs", { login: member.login })}</p> : null}
              </div>
            </div>

            {director && member.active ? (
              <form
                id="member-form"
                className="flex flex-col gap-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run();
                }}
              >
                {error ? <Alert tone="danger">{error}</Alert> : null}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("team.role")}>
                    <NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "employee" | "manager" })}>
                      <option value="employee">{t("roles.employee")}</option>
                      <option value="manager">{t("roles.manager")}</option>
                    </NativeSelect>
                  </Field>
                  <Field label={t("team.branch")} error={fieldErrors.branchId}>
                    <NativeSelect value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                      {me.branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={t("team.position")} error={fieldErrors.position}>
                    <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} maxLength={120} placeholder={t("team.positionPlaceholder")} />
                  </Field>
                  <Field label={t("team.phone")} hint={t("team.phoneHint")} error={fieldErrors.phone}>
                    <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+7 700 000 00 00" />
                  </Field>
                </div>
                {form.role === "manager" ? (
                  <Switch checked={form.canInvite} onChange={(v) => setForm({ ...form, canInvite: v })} label={t("team.canInvite")} hint={t("team.canInviteHint")} />
                ) : null}
              </form>
            ) : null}

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              {member.active && me.capabilities.resetPasswords ? (
                <button type="button" disabled={busy} onClick={() => void resetLink()} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted">
                  <KeyRound className="size-5 text-primary" />
                  <span>
                    <span className="block text-[15px] font-semibold">{t("team.resetPassword")}</span>
                    <span className="block text-sm text-muted-foreground">{t("team.resetPasswordHint")}</span>
                  </span>
                </button>
              ) : null}
              {director ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleAccess()}
                  className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 text-left", member.active ? "text-danger hover:bg-danger/5" : "hover:bg-muted")}
                >
                  {busy ? <Spinner /> : member.active ? <X className="size-5" /> : <Check className="size-5 text-success" />}
                  <span>
                    <span className="block text-[15px] font-semibold">{member.active ? t("team.closeAccess") : t("team.restoreAccess")}</span>
                    <span className="block text-sm text-muted-foreground">{member.active ? t("team.closeAccessHint") : t("team.restoreAccessHint")}</span>
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
