"use client";

import { Archive, MoreHorizontal, Pencil, Plus, Store, Users } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { errorText, t } from "@/lib/i18n";
import { Loading, useLoad } from "./common";

type Branch = { id: string; name: string; members: number };

const IDEAS = ["Центральный", "Север", "Юг", "Онлайн"];

export function BranchesTab() {
  const { refreshMe, setBranchId, me } = useCabinet();
  const toast = useToast();
  const { data, error, load } = useLoad<{ branches: Branch[] }>("/api/branches");
  const [dialog, setDialog] = React.useState<{ mode: "create" } | { mode: "rename"; branch: Branch } | null>(null);
  const [archiving, setArchiving] = React.useState<Branch | null>(null);

  const after = async (created?: { id: string }) => {
    load();
    const hadNone = me.branches.length === 0;
    await refreshMe();
    if (created && hadNone) setBranchId(created.id);
  };

  if (!data) return <Loading error={error} onRetry={load} />;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("branch.intro")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.branches.map((b, i) => (
          <Card key={b.id} className="am-lift am-fade-up group relative flex flex-col gap-4 p-4" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="flex items-start justify-between gap-2">
              <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
                <Store className="size-5" />
              </span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger className="-m-1 rounded-lg p-1.5 text-foreground/50 hover:bg-muted hover:text-foreground" aria-label={t("app.more")}>
                  <MoreHorizontal className="size-5" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} className="am-pop z-50 min-w-48 rounded-xl border border-border bg-surface p-1 shadow-xl">
                    <DropdownMenu.Item
                      onSelect={() => setDialog({ mode: "rename", branch: b })}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] outline-none data-[highlighted]:bg-muted"
                    >
                      <Pencil className="size-4" />
                      {t("branch.rename")}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      onSelect={() => setArchiving(b)}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] text-destructive outline-none data-[highlighted]:bg-destructive/5"
                    >
                      <Archive className="size-4" />
                      {t("branch.archive")}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            <div className="min-w-0">
              <h3 className="break-words text-[17px] font-bold leading-snug">{b.name}</h3>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Users className="size-4" />
                {t("branch.members", { n: b.members })}
              </p>
            </div>
          </Card>
        ))}
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="am-lift flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 text-foreground/60 transition-colors hover:border-primary/50 hover:bg-selected/40 hover:text-primary"
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-muted">
            <Plus className="size-5" />
          </span>
          <span className="text-[15px] font-semibold">{t("branch.create")}</span>
        </button>
      </div>

      <BranchDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSaved={(b, created) => {
          toast(created ? t("branch.created", { name: b.name }) : t("branch.renamed"));
          void after(created ? b : undefined);
        }}
      />
      <ArchiveDialog
        branch={archiving}
        onClose={() => setArchiving(null)}
        onDone={() => {
          toast(t("branch.archived"));
          void after();
        }}
      />
    </div>
  );
}

function BranchDialog({
  state,
  onClose,
  onSaved,
}: {
  state: { mode: "create" } | { mode: "rename"; branch: Branch } | null;
  onClose: () => void;
  onSaved: (branch: { id: string; name: string }, created: boolean) => void;
}) {
  const [name, setName] = React.useState("");
  const editing = state?.mode === "rename" ? state.branch : null;
  React.useEffect(() => {
    if (state) setName(editing?.name ?? "");
  }, [state, editing]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    if (editing) {
      await api("PATCH", `/api/branches/${editing.id}`, { name });
      onClose();
      onSaved({ id: editing.id, name }, false);
    } else {
      const created = await api<{ id: string; name: string }>("POST", "/api/branches", { name });
      onClose();
      onSaved(created, true);
    }
  });

  return (
    <Dialog open={Boolean(state)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={editing ? t("branch.rename") : t("branch.create")}
        description={editing ? undefined : t("branch.createHint")}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" form="branch-form" disabled={pending || !name.trim()}>
              {pending ? <Spinner /> : null}
              {editing ? t("app.save") : t("app.create")}
            </Button>
          </>
        }
      >
        <form
          id="branch-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
              <Store className="size-6" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[17px] font-bold">{name.trim() || t("branch.namePlaceholder")}</span>
              <span className="block text-sm text-muted-foreground">{editing ? t("branch.members", { n: editing.members }) : t("branch.newBadge")}</span>
            </span>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t("branch.name")} error={fieldErrors.name}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoFocus placeholder={t("branch.namePlaceholder")} />
          </Field>
          {!editing ? (
            <div className="flex flex-wrap gap-2">
              {IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setName(idea)} className="rounded-full border border-border px-3 py-1 text-sm text-foreground/70 hover:bg-muted">
                  {idea}
                </button>
              ))}
            </div>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ArchiveDialog({ branch, onClose, onDone }: { branch: Branch | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setError(null), [branch]);
  const blocked = (branch?.members ?? 0) > 0;
  return (
    <Dialog open={Boolean(branch)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={t("branch.archiveTitle", { name: branch?.name ?? "" })}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {t("app.cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={busy || blocked}
              onClick={async () => {
                if (!branch) return;
                setBusy(true);
                try {
                  await api("DELETE", `/api/branches/${branch.id}`);
                  onClose();
                  onDone();
                } catch (e) {
                  setError(errorText(e instanceof ApiError ? e.code : "network"));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner /> : null}
              {t("branch.archive")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-[15px]">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <p>{blocked ? t("branch.archiveBlocked") : t("branch.archiveText")}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
