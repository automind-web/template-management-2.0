"use client";

import { ArrowLeft, ChevronDown, Download, Pencil, RotateCcw, Trash2, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { LoadError, useSubmit } from "@/components/forms";
import { DueLabel, StatusBadge, transitionLabel } from "@/components/tasks/labels";
import { AttachButton, EditTaskDialog, StatusDialog } from "@/components/tasks/task-dialogs";
import type { TaskCard, TransitionInfo } from "@/components/tasks/types";
import { useTaskAction, useTaskCard, type Notice } from "@/components/tasks/use-task";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { errorText, formatDateTime, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/** Назад — в ту же выдачу списка (с филиалом, фильтрами и прокруткой). */
function useBack() {
  return React.useCallback((e: React.MouseEvent) => {
    try {
      if (document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1) {
        e.preventDefault();
        window.history.back();
      }
    } catch {
      /* обычный переход по ссылке */
    }
  }, []);
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { card, setCard, load, loadError } = useTaskCard(id);
  const back = useBack();

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <Link href="/tasks" className="inline-flex items-center gap-1 text-sm text-primary">
          <ArrowLeft className="size-4" /> {t("tasks.card.back")}
        </Link>
        {loadError === "task_not_found" || loadError === "not_found" ? (
          <Alert tone="danger">{t("tasks.card.notFound")}</Alert>
        ) : (
          <LoadError onRetry={load} message={errorText(loadError)} />
        )}
      </div>
    );
  }
  if (!card) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Spinner /> {t("app.loading")}
      </p>
    );
  }
  return <TaskView card={card} setCard={setCard} onBack={back} />;
}

function TaskView({ card, setCard, onBack }: { card: TaskCard; setCard: (c: TaskCard) => void; onBack: (e: React.MouseEvent) => void }) {
  const act = useTaskAction(setCard);
  const [notice, setNotice] = React.useState<Notice>(null);
  const [statusDialog, setStatusDialog] = React.useState<TransitionInfo | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const task = card.task;
  const primary = card.transitions.find((tr) => tr.to === card.primary) ?? null;
  const others = card.transitions.filter((tr) => tr !== primary);

  /** После сохранения — фактический статус и следующее действие. */
  const afterSave = (next: TaskCard) => {
    const nextPrimary = next.transitions.find((tr) => tr.to === next.primary);
    const parts = [
      next.replayed ? t("tasks.card.replayed") : t("tasks.card.saved", { status: next.task.status.name }),
      nextPrimary ? t("tasks.card.next", { action: transitionLabel(nextPrimary, next.task.status.category) }) : "",
    ];
    setNotice({ tone: "success", text: parts.filter(Boolean).join(" ") });
  };

  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.code === "version_conflict") setNotice({ tone: "neutral", text: t("tasks.card.conflict") });
    else setNotice({ tone: "danger", text: errorText(e instanceof ApiError ? e.code : "network") });
  };

  const runTransition = async (tr: TransitionInfo) => {
    setNotice(null);
    if (tr.requires.comment || tr.requires.result) {
      setStatusDialog(tr);
      return;
    }
    try {
      afterSave(await act("POST", `/api/tasks/${task.id}/status`, { to: tr.to }, task.version));
    } catch (e) {
      onError(e);
    }
  };

  const [busy, setBusy] = React.useState(false);
  const guarded = (fn: () => Promise<void>) => async () => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const toggleChecklist = async (itemId: string) => {
    const checklist = task.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c));
    setCard({ ...card, task: { ...task, checklist } });
    try {
      await act("PATCH", `/api/tasks/${task.id}`, { checklist }, task.version);
    } catch (e) {
      onError(e);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Link href="/tasks" onClick={onBack} className="inline-flex w-fit items-center gap-1 text-sm text-primary">
        <ArrowLeft className="size-4" /> {t("tasks.card.back")}
      </Link>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{t("tasks.number", { n: task.number })}</span>
          <StatusBadge status={task.status} cancelled={Boolean(task.cancelledAt)} />
          {task.isPersonal ? <span className="text-xs">· {t("tasks.personal")}</span> : null}
        </div>
        <h1 className="break-words text-xl font-semibold">{task.title}</h1>
        {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
        {task.cancelledAt ? <Alert>{t("tasks.card.cancelled")}</Alert> : null}

        <div className="flex flex-wrap gap-2">
          {primary ? (
            <Button disabled={busy} onClick={guarded(() => runTransition(primary))}>
              {busy ? <Spinner /> : null}
              {transitionLabel(primary, task.status.category)}
            </Button>
          ) : null}
          {others.length ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button variant="outline" disabled={busy}>
                  {t("tasks.card.changeStatus")}
                  <ChevronDown />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="start" sideOffset={6} className="z-50 min-w-56 rounded-md border border-border bg-surface p-1 shadow-lg">
                  {others.map((tr) => (
                    <DropdownMenu.Item
                      key={tr.to}
                      onSelect={() => void guarded(() => runTransition(tr))()}
                      className="cursor-pointer rounded-sm px-2 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                    >
                      {transitionLabel(tr, task.status.category)}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
          {card.permissions.edit ? (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil />
              {t("tasks.card.edit")}
            </Button>
          ) : null}
          {card.permissions.cancel && !task.cancelledAt ? (
            <Button variant="ghost" onClick={() => setCancelling(true)}>
              <XCircle />
              {t("tasks.card.cancel")}
            </Button>
          ) : null}
          {card.permissions.cancel && task.cancelledAt ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={guarded(async () => {
                try {
                  afterSave(await act("POST", `/api/tasks/${task.id}/restore`, {}, task.version));
                } catch (e) {
                  onError(e);
                }
              })}
            >
              <RotateCcw />
              {t("tasks.card.restore")}
            </Button>
          ) : null}
        </div>
        {!primary && !others.length && !task.cancelledAt ? <p className="text-sm text-muted-foreground">{t("tasks.card.noActions")}</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4 pt-4 sm:pt-6">
              <section>
                <h2 className="mb-1 text-sm font-medium text-muted-foreground">{t("tasks.card.description")}</h2>
                <p className="whitespace-pre-wrap break-words text-sm">{task.description || t("tasks.card.noDescription")}</p>
              </section>
              {task.resultCriteria ? (
                <section>
                  <h2 className="mb-1 text-sm font-medium text-muted-foreground">{t("tasks.card.resultCriteria")}</h2>
                  <p className="whitespace-pre-wrap break-words text-sm">{task.resultCriteria}</p>
                </section>
              ) : null}
              {task.checklist.length ? (
                <section>
                  <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                    {t("tasks.card.checklist")} · {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
                  </h2>
                  <ul className="flex flex-col gap-1">
                    {task.checklist.map((item) => (
                      <li key={item.id}>
                        <label className="flex items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4"
                            checked={item.done}
                            disabled={!card.permissions.checklist || Boolean(task.cancelledAt)}
                            onChange={() => void toggleChecklist(item.id)}
                          />
                          <span className={cn("break-words", item.done && "text-muted-foreground line-through")}>{item.text}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </CardContent>
          </Card>

          <AttachmentsCard card={card} setCard={setCard} onError={onError} />
          <CommentsCard card={card} act={act} onError={onError} />
          <HistoryCard card={card} />
        </div>

        <Card className="h-fit">
          <CardContent className="pt-4 sm:pt-6">
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">{t("tasks.card.assignee")}</dt>
                <dd className="break-words font-medium">{task.assignee.displayName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("tasks.card.due")}</dt>
                <dd>
                  <DueLabel dueDate={task.dueDate} overdue={task.overdue} className="text-sm" />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("tasks.card.creator")}</dt>
                <dd className="break-words">{task.creator.displayName}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("tasks.card.branch")}</dt>
                <dd className="break-words">{task.branchName}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <StatusDialog
        card={card}
        transition={statusDialog}
        open={Boolean(statusDialog)}
        onOpenChange={(o) => !o && setStatusDialog(null)}
        act={act}
        setCard={setCard}
        onDone={afterSave}
      />
      <EditTaskDialog card={card} open={editing} onOpenChange={setEditing} act={act} onSaved={afterSave} />
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent title={t("tasks.card.cancel")} description={t("tasks.card.cancelConfirm")}>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelling(false)}>
              {t("app.no")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={guarded(async () => {
                try {
                  afterSave(await act("POST", `/api/tasks/${task.id}/cancel`, {}, task.version));
                  setCancelling(false);
                } catch (e) {
                  setCancelling(false);
                  onError(e);
                }
              })}
            >
              {t("tasks.card.cancel")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttachmentsCard({ card, setCard, onError }: { card: TaskCard; setCard: (c: TaskCard) => void; onError: (e: unknown) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-3">
        <CardTitle className="text-base">{t("tasks.card.attachments")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {card.attachments.length === 0 ? <p className="text-sm text-muted-foreground">{t("tasks.card.noAttachments")}</p> : null}
        <ul className="flex flex-col gap-2">
          {card.attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              {a.contentType.startsWith("image/") ? (
                <img src={`/api/attachments/${a.id}`} alt="" className="size-12 shrink-0 rounded-md border border-border object-cover" loading="lazy" />
              ) : null}
              <div className="min-w-0 flex-1 text-sm">
                <a href={`/api/attachments/${a.id}`} className="block truncate text-primary hover:underline" target="_blank" rel="noopener">
                  {a.fileName}
                </a>
                <p className="text-xs text-muted-foreground">
                  {formatSize(a.size)} · {a.uploader} · {formatDateTime(a.createdAt)}
                </p>
              </div>
              <a
                href={`/api/attachments/${a.id}`}
                download={a.fileName}
                className="rounded-md p-2 hover:bg-muted"
                aria-label={`${t("app.open")}: ${a.fileName}`}
              >
                <Download className="size-4" />
              </a>
              {a.canDelete ? (
                <button
                  type="button"
                  className="rounded-md p-2 text-muted-foreground hover:bg-muted"
                  aria-label={`${t("tasks.card.deleteFile")}: ${a.fileName}`}
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE", credentials: "same-origin" });
                      const data = await res.json().catch(() => null);
                      if (!res.ok) throw new ApiError(data?.error?.code ?? "internal", res.status, null);
                      setCard({ ...card, attachments: card.attachments.filter((x) => x.id !== a.id) });
                    } catch (e) {
                      onError(e);
                    }
                  }}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {card.permissions.attach ? <AttachButton taskId={card.task.id} onUploaded={setCard} /> : null}
      </CardContent>
    </Card>
  );
}

function CommentsCard({
  card,
  act,
  onError,
}: {
  card: TaskCard;
  act: ReturnType<typeof useTaskAction>;
  onError: (e: unknown) => void;
}) {
  const [body, setBody] = React.useState("");
  const { run, pending, error } = useSubmit(async () => {
    await act("POST", `/api/tasks/${card.task.id}/comments`, { body });
    setBody("");
  });
  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-3">
        <CardTitle className="text-base">{t("tasks.card.comments")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {card.comments.length === 0 ? <p className="text-sm text-muted-foreground">{t("tasks.card.noComments")}</p> : null}
        <ul className="flex flex-col gap-3">
          {card.comments.map((c) => (
            <li
              key={c.id}
              className={cn(
                "rounded-md border p-3 text-sm",
                c.kind === "result" ? "border-success/30 bg-success/5" : c.kind === "return" ? "border-warning/30 bg-warning/5" : "border-border",
              )}
            >
              <p className="mb-1 text-xs text-muted-foreground">
                {c.kind !== "comment" ? <span className="font-medium">{t(`tasks.card.commentKinds.${c.kind}`)} · </span> : null}
                {c.author} · {formatDateTime(c.createdAt)}
              </p>
              <p className="whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run().catch(onError);
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("tasks.card.commentPlaceholder")}
            aria-label={t("tasks.card.commentPlaceholder")}
            rows={2}
            maxLength={10000}
          />
          <div>
            <Button type="submit" variant="outline" size="sm" disabled={pending || !body.trim()}>
              {pending ? <Spinner /> : null}
              {t("tasks.card.commentSend")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function historyText(h: TaskCard["history"][number]): string {
  const empty = t("tasks.history.empty");
  const label = t(`tasks.history.${h.type}`);
  const pair = () => `${h.oldValue ?? empty} → ${h.newValue ?? empty}`;
  switch (h.type) {
    case "assigned":
      return h.oldValue ? `${label}: ${pair()}` : `${label}: ${h.newValue}`;
    case "due_changed":
      return `${label}: ${pair()}`;
    case "status_changed":
    case "submitted":
    case "accepted":
    case "returned":
    case "reopened":
      return `${label}: ${pair()}`;
    case "field_changed":
      return `${label} «${t(`tasks.history.fields.${h.field}`)}»${h.field === "title" ? `: ${pair()}` : ""}`;
    case "checklist_changed":
      return `${label}: ${pair()}`;
    case "attachment":
      return `${label}: ${h.newValue}`;
    case "attachment_deleted":
      return `${label}: ${h.oldValue}`;
    default:
      return label;
  }
}

function HistoryCard({ card }: { card: TaskCard }) {
  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-3">
        <CardTitle className="text-base">{t("tasks.card.history")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col gap-2">
          {card.history.map((h) => (
            <li key={h.id} className="border-l-2 border-border pl-3 text-sm">
              <p className="break-words">{historyText(h)}</p>
              {h.comment ? <p className="whitespace-pre-wrap break-words text-muted-foreground">«{h.comment}»</p> : null}
              <p className="text-xs text-muted-foreground">
                {h.actor} · {formatDateTime(h.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
