"use client";

import { ArrowLeft, ChevronDown, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError, useSubmit } from "@/components/forms";
import { assigneeLabel, useAssignees } from "@/components/tasks/create-task-dialog";
import { DueText, StatusPill, transitionLabel } from "@/components/tasks/labels";
import { AttachButtons, StatusDialog } from "@/components/tasks/task-dialogs";
import type { ChecklistItem, TaskCard, TransitionInfo } from "@/components/tasks/types";
import { useTaskAction, useTaskCard, type Notice } from "@/components/tasks/use-task";
import { Button, Kbd } from "@/components/ui/button";
import { Alert, Card, Meta, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { onSubmitShortcut, useSubmitShortcutLabel } from "@/lib/hotkeys";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

/** Назад — в ту же выдачу списка (филиал, фильтры, прокрутка). */
function goBack(e: React.MouseEvent) {
  try {
    if (document.referrer && new URL(document.referrer).origin === window.location.origin && window.history.length > 1) {
      e.preventDefault();
      window.history.back();
    }
  } catch {
    /* обычный переход по ссылке */
  }
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { card, setCard, load, loadError } = useTaskCard(id);

  return (
    <>
      <PageHeader title={t("tasks.title")} />
      <PageBody>
        <Link href="/tasks" onClick={goBack} className="mb-3 inline-flex items-center gap-1.5 text-[15px] font-semibold text-primary">
          <ArrowLeft className="size-4" /> {t("tasks.card.back")}
        </Link>
        {loadError ? (
          loadError === "task_not_found" || loadError === "not_found" ? (
            <Alert tone="danger">{t("tasks.card.notFound")}</Alert>
          ) : (
            <LoadError onRetry={load} message={errorText(loadError)} />
          )
        ) : !card ? (
          <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> {t("app.loading")}
          </p>
        ) : (
          <TaskView card={card} setCard={setCard} />
        )}
      </PageBody>
    </>
  );
}

type Draft = { title: string; description: string; resultCriteria: string; assigneeId: string; dueDate: string; dueTime: string };

function draftOf(card: TaskCard): Draft {
  const task = card.task;
  return {
    title: task.title,
    description: task.description ?? "",
    resultCriteria: task.resultCriteria ?? "",
    assigneeId: task.assignee.id,
    dueDate: task.dueDate ?? "",
    dueTime: task.dueDate ? (task.dueTime ?? "") : "",
  };
}

function TaskView({ card, setCard }: { card: TaskCard; setCard: (c: TaskCard) => void }) {
  const { me } = useCabinet();
  const act = useTaskAction(setCard);
  const shortcut = useSubmitShortcutLabel();
  const [notice, setNotice] = React.useState<Notice>(null);
  const [statusDialog, setStatusDialog] = React.useState<TransitionInfo | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const task = card.task;
  const canEdit = card.permissions.edit;
  const assignees = useAssignees(task.branchId, canEdit);

  // Черновик полей. При обновлении карточки (в т. ч. после конфликта) неизменённые поля
  // берут новые значения, а введённое участником сохраняется.
  const [draft, setDraft] = React.useState<Draft>(() => draftOf(card));
  const baseline = React.useRef<Draft>(draftOf(card));
  React.useEffect(() => {
    const next = draftOf(card);
    setDraft((d) => {
      const merged = { ...d };
      for (const k of Object.keys(next) as (keyof Draft)[]) if (d[k] === baseline.current[k]) merged[k] = next[k];
      return merged;
    });
    baseline.current = next;
  }, [card]);
  const current = draftOf(card);
  const changed = (Object.keys(current) as (keyof Draft)[]).filter((k) => draft[k] !== current[k]);
  const dirty = canEdit && changed.length > 0;

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

  const save = useSubmit(async () => {
    const body: Record<string, unknown> = {};
    for (const k of changed) {
      if (k === "dueDate") body.dueDate = draft.dueDate || null;
      else if (k === "dueTime") body.dueTime = draft.dueTime || null;
      else if (k === "description" || k === "resultCriteria") body[k] = draft[k].trim() || null;
      else body[k] = draft[k];
    }
    if (changed.includes("dueDate") && draft.dueDate && !changed.includes("dueTime")) body.dueTime = draft.dueTime || null;
    try {
      afterSave(await act("PATCH", `/api/tasks/${task.id}`, body, task.version));
    } catch (e) {
      onError(e);
    }
  });

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

  const saveChecklist = async (checklist: ChecklistItem[]) => {
    setCard({ ...card, task: { ...task, checklist } });
    try {
      await act("PATCH", `/api/tasks/${task.id}`, { checklist }, task.version);
    } catch (e) {
      onError(e);
    }
  };

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="flex flex-col gap-4">
      {/* Основное действие для роли и остальные переходы. */}
      {primary || others.length || dirty ? (
        <div className="flex flex-wrap items-center gap-2">
          {primary ? (
            <Button disabled={busy || dirty} onClick={guarded(() => runTransition(primary))}>
              {busy ? <Spinner /> : null}
              {transitionLabel(primary, task.status.category)}
            </Button>
          ) : null}
          {others.length ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button variant="outline" disabled={busy || dirty}>
                  {t("tasks.card.changeStatus")}
                  <ChevronDown />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="start" sideOffset={6} className="z-50 min-w-56 rounded-lg border border-border bg-surface p-1 shadow-lg">
                  {others.map((tr) => (
                    <DropdownMenu.Item
                      key={tr.to}
                      onSelect={() => void guarded(() => runTransition(tr))()}
                      className="cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                    >
                      {transitionLabel(tr, task.status.category)}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ) : null}
          {dirty ? (
            <>
              <Button type="submit" form="task-fields" variant={primary ? "outline" : "default"} disabled={save.pending}>
                {save.pending ? <Spinner /> : null}
                {t("tasks.card.saveChanges")}
                <Kbd>{shortcut}</Kbd>
              </Button>
              <Button variant="ghost" onClick={() => setDraft(current)}>
                {t("tasks.card.discard")}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {task.cancelledAt ? <Alert>{t("tasks.card.cancelled", { status: me.cancelledName })}</Alert> : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex min-w-0 flex-col divide-y divide-border">
          <form
            id="task-fields"
            className="flex flex-col gap-4 p-4 sm:p-5"
            onKeyDown={onSubmitShortcut}
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) void save.run();
            }}
          >
            {canEdit ? (
              <Field label={t("tasks.form.title")}>
                <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} required maxLength={300} className="font-semibold" />
              </Field>
            ) : (
              <h2 className="break-words text-xl font-bold">{task.title}</h2>
            )}
            <div className="-mt-1 flex flex-wrap items-center gap-3">
              <StatusPill status={task.status} cancelledName={task.cancelledAt ? me.cancelledName : null} />
              <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={me.company.timezone} />
            </div>
            {canEdit ? (
              <>
                <Field label={t("tasks.form.description")}>
                  <Textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} rows={4} maxLength={10000} />
                </Field>
                <Field label={t("tasks.form.resultCriteria")}>
                  <Textarea
                    value={draft.resultCriteria}
                    onChange={(e) => set({ resultCriteria: e.target.value })}
                    rows={3}
                    maxLength={5000}
                    placeholder={t("tasks.form.resultCriteriaHint")}
                  />
                </Field>
              </>
            ) : (
              <>
                <ReadBlock label={t("tasks.form.description")} text={task.description} />
                {task.resultCriteria ? <ReadBlock label={t("tasks.form.resultCriteria")} text={task.resultCriteria} /> : null}
              </>
            )}
          </form>

          <ChecklistSection card={card} onChange={saveChecklist} />

          <section className="flex flex-col gap-3 p-4 sm:p-5">
            <h3 className="text-[17px] font-bold">{t("tasks.card.attachments")}</h3>
            {card.attachments.length === 0 ? <p className="text-sm text-muted-foreground">{t("tasks.card.noAttachments")}</p> : null}
            {card.attachments.length ? (
              <ul className="flex flex-col gap-2">
                {card.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3">
                    {a.contentType.startsWith("image/") ? (
                      <img src={`/api/attachments/${a.id}`} alt="" loading="lazy" className="size-11 shrink-0 rounded-md border border-border object-cover" />
                    ) : null}
                    <div className="min-w-0 flex-1 text-sm">
                      <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener" className="block truncate font-medium text-primary hover:underline">
                        {a.fileName}
                      </a>
                      <p className="text-xs text-muted-foreground">
                        {formatSize(a.size)} · {a.uploader} · {formatShortDateTime(a.createdAt, me.company.timezone)}
                      </p>
                    </div>
                    {a.canDelete ? (
                      <button
                        type="button"
                        className="rounded-md p-2 text-foreground/60 hover:bg-muted"
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
            ) : null}
            {card.permissions.attach ? <AttachButtons taskId={task.id} onUploaded={setCard} /> : null}
          </section>

          <CommentsSection card={card} act={act} />
        </Card>

        <div className="flex flex-col gap-4">
          {card.permissions.cancel && !task.cancelledAt ? (
            <Button variant="danger" size="lg" className="w-full" onClick={() => setCancelling(true)}>
              {t("tasks.card.cancel")}
            </Button>
          ) : null}
          {card.permissions.cancel && task.cancelledAt ? (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={guarded(async () => {
                try {
                  afterSave(await act("POST", `/api/tasks/${task.id}/restore`, {}, task.version));
                } catch (e) {
                  onError(e);
                }
              })}
            >
              {t("tasks.card.restore")}
            </Button>
          ) : null}

          <Card className="p-4 sm:p-5">
            <dl className="flex flex-col gap-4 text-[15px]">
              <Meta label="№">#{task.number}</Meta>
              <Meta label={t("tasks.card.branch")}>{task.branchName}</Meta>
              {canEdit ? (
                <>
                  <Field label={t("tasks.card.assignee")}>
                    <NativeSelect value={draft.assigneeId} onChange={(e) => set({ assigneeId: e.target.value })} form="task-fields" className="font-semibold">
                      {!assignees?.some((a) => a.userId === task.assignee.id) ? <option value={task.assignee.id}>{task.assignee.displayName}</option> : null}
                      {(assignees ?? []).map((a) => (
                        <option key={a.userId} value={a.userId}>
                          {assigneeLabel(a)}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field label={t("tasks.card.due")}>
                    <Input type="date" value={draft.dueDate} onChange={(e) => set({ dueDate: e.target.value })} form="task-fields" />
                  </Field>
                  <Field label={t("tasks.card.time")} hint={draft.dueDate && !draft.dueTime ? t("tasks.form.dueTimeHint", { time: me.dueTime }) : undefined}>
                    <Input type="time" value={draft.dueTime} onChange={(e) => set({ dueTime: e.target.value })} disabled={!draft.dueDate} form="task-fields" />
                  </Field>
                  {draft.dueDate ? (
                    <Button variant="link" className="w-fit" onClick={() => set({ dueDate: "", dueTime: "" })}>
                      {t("tasks.card.clearDue")}
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <Meta label={t("tasks.card.assignee")}>{task.assignee.displayName}</Meta>
                  <Meta label={t("tasks.card.due")}>
                    <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={me.company.timezone} />
                  </Meta>
                </>
              )}
              <Meta label={t("tasks.card.creator")}>{task.creator.displayName}</Meta>
              <Meta label={t("tasks.card.created")}>{formatShortDateTime(task.createdAt, me.company.timezone)}</Meta>
            </dl>
          </Card>

          <details open className="group">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[15px] font-bold [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0" aria-hidden />
              {t("tasks.card.history", { n: card.history.length })}
            </summary>
            <ol className="mt-2 flex flex-col gap-3">
              {card.history.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="break-words">{historyText(h)}</p>
                  {h.comment ? <p className="whitespace-pre-wrap break-words text-foreground/75">«{h.comment}»</p> : null}
                  <p className="text-muted-foreground">
                    {h.actor} · {formatShortDateTime(h.createdAt, me.company.timezone)}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        </div>
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
      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent
          title={t("tasks.card.cancel")}
          description={t("tasks.card.cancelConfirm")}
          footer={
            <>
              <Button variant="outline" onClick={() => setCancelling(false)}>
                {t("app.no")}
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={guarded(async () => {
                  try {
                    afterSave(await act("POST", `/api/tasks/${task.id}/cancel`, {}, task.version));
                  } catch (e) {
                    onError(e);
                  }
                  setCancelling(false);
                })}
              >
                {t("tasks.card.cancel")}
              </Button>
            </>
          }
        >
          <p className="break-words text-[15px] font-semibold">{task.title}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReadBlock({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <Label>{label}</Label>
      <p className="mt-1 whitespace-pre-wrap break-words text-[15px]">{text || t("tasks.card.noDescription")}</p>
    </div>
  );
}

function ChecklistSection({ card, onChange }: { card: TaskCard; onChange: (items: ChecklistItem[]) => void }) {
  const [text, setText] = React.useState("");
  const items = card.task.checklist;
  const canToggle = card.permissions.checklist && !card.task.cancelledAt;
  const canEdit = card.permissions.edit;
  if (!canEdit && items.length === 0) return null;
  const add = () => {
    const value = text.trim();
    if (!value) return;
    onChange([...items, { id: crypto.randomUUID().slice(0, 8), text: value, done: false }]);
    setText("");
  };
  return (
    <section className="flex flex-col gap-3 p-4 sm:p-5">
      <h3 className="text-[17px] font-bold">
        {t("tasks.card.checklist")}
        {items.length ? <span className="ml-2 text-sm font-semibold text-muted-foreground">{items.filter((i) => i.done).length}/{items.length}</span> : null}
      </h3>
      {items.length ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 text-[15px]">
                <input
                  type="checkbox"
                  className="mt-0.5 size-[18px] shrink-0 accent-[var(--am-accent)]"
                  checked={item.done}
                  disabled={!canToggle}
                  onChange={() => onChange(items.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)))}
                />
                <span className={cn("break-words", item.done && "text-muted-foreground line-through")}>{item.text}</span>
              </label>
              {canEdit ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-foreground/50 hover:bg-muted"
                  aria-label={`${t("tasks.card.removeItem")}: ${item.text}`}
                  onClick={() => onChange(items.filter((c) => c.id !== item.id))}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                add();
              }
            }}
            placeholder={t("tasks.card.newItem")}
            aria-label={t("tasks.card.newItem")}
            maxLength={300}
          />
          <div>
            <Button variant="outline" size="sm" onClick={add} disabled={!text.trim()}>
              {t("tasks.card.addItem")}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function CommentsSection({ card, act }: { card: TaskCard; act: ReturnType<typeof useTaskAction> }) {
  const { me } = useCabinet();
  const [body, setBody] = React.useState("");
  const shortcut = useSubmitShortcutLabel();
  const { run, pending, error } = useSubmit(async () => {
    await act("POST", `/api/tasks/${card.task.id}/comments`, { body });
    setBody("");
  });
  return (
    <section className="flex flex-col gap-3 p-4 sm:p-5">
      <h3 className="text-[17px] font-bold">{t("tasks.card.comments")}</h3>
      {card.comments.length ? (
        <ul className="flex flex-col gap-2.5">
          {card.comments.map((c) => (
            <li
              key={c.id}
              className={cn(
                "rounded-lg border p-3 text-[15px]",
                c.kind === "result" ? "border-success/30 bg-success/5" : c.kind === "return" ? "border-warning/30 bg-warning/5" : "border-border bg-muted/40",
              )}
            >
              <p className="mb-1 text-[13px] text-muted-foreground">
                {c.kind !== "comment" ? <span className="font-semibold text-foreground/80">{t(`tasks.card.commentKinds.${c.kind}`)} · </span> : null}
                {c.author} · {formatShortDateTime(c.createdAt, me.company.timezone)}
              </p>
              <p className="whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onKeyDown={onSubmitShortcut}
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) void run();
        }}
      >
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("tasks.card.commentPlaceholder")}
          aria-label={t("tasks.card.commentPlaceholder")}
          rows={3}
          maxLength={10000}
        />
        <div>
          <Button type="submit" variant="outline" disabled={pending || !body.trim()}>
            {pending ? <Spinner /> : null}
            {t("tasks.card.commentSend")}
            <Kbd>{shortcut}</Kbd>
          </Button>
        </div>
      </form>
    </section>
  );
}

function historyText(h: TaskCard["history"][number]): string {
  const empty = t("tasks.history.empty");
  const label = t(`tasks.history.${h.type}`);
  const due = (v: string | null) => {
    if (!v) return t("tasks.due.none");
    const [date, time] = v.split(" ");
    const [y, m, d] = (date ?? "").split("-").map(Number);
    if (!y || !m || !d) return v;
    const month = new Intl.DateTimeFormat("ru-RU", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
    return `${d} ${month}${time ? `, ${time}` : ""}`;
  };
  const pair = (a: string | null, b: string | null) => `${a ?? empty} → ${b ?? empty}`;
  switch (h.type) {
    case "created":
      return label;
    case "assigned":
      return h.oldValue ? `${label}: ${pair(h.oldValue, h.newValue)}` : `${t("tasks.history.assignedFirst")} ${h.newValue}`;
    case "due_changed":
      return `${label}: ${pair(due(h.oldValue), due(h.newValue))}`;
    case "status_changed":
    case "submitted":
    case "accepted":
    case "returned":
    case "reopened":
      return `${label}: ${pair(h.oldValue, h.newValue)}`;
    case "field_changed":
      return `${label} «${t(`tasks.history.fields.${h.field}`)}»${h.field === "title" ? `: ${pair(h.oldValue, h.newValue)}` : ""}`;
    case "checklist_changed":
      return `${label}: ${pair(h.oldValue, h.newValue)}`;
    case "attachment":
      return `${label}: ${h.newValue}`;
    case "attachment_deleted":
      return `${label}: ${h.oldValue}`;
    default:
      return label;
  }
}
