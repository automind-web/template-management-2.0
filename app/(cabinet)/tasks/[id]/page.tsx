"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  History,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  SendHorizontal,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { useAssignees } from "@/components/tasks/create-task-dialog";
import { DueText, StatusPill, transitionLabel } from "@/components/tasks/labels";
import { AssigneePicker, DuePicker, PickerChip } from "@/components/tasks/pickers";
import { applyCard, useTaskCard } from "@/components/tasks/store";
import { AttachButtons, StatusDialog } from "@/components/tasks/task-dialogs";
import type { ChecklistItem, TaskCard, TaskListItem, TransitionInfo } from "@/components/tasks/types";
import { useTaskAction } from "@/components/tasks/use-task";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { onSubmitShortcut } from "@/lib/hotkeys";
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
  const { card, preview, load, loadError } = useTaskCard(id);

  return (
    <>
      <PageHeader title={t("tasks.title")} />
      <PageBody className="mx-auto grid w-full max-w-3xl gap-4">
        <Link
          href="/tasks"
          onClick={goBack}
          className="inline-flex w-fit items-center gap-1.5 rounded-lg text-[15px] font-semibold text-primary hover:underline"
        >
          <ArrowLeft className="size-4" /> {t("tasks.card.back")}
        </Link>
        {card ? (
          <TaskView card={card} />
        ) : loadError ? (
          loadError === "task_not_found" || loadError === "not_found" ? (
            <Alert tone="danger">{t("tasks.card.notFound")}</Alert>
          ) : (
            <LoadError onRetry={load} message={errorText(loadError)} />
          )
        ) : (
          <CardSkeleton preview={preview} />
        )}
      </PageBody>
    </>
  );
}

/** Пока карточка грузится — то, что уже известно из списка, и заготовка остального (без «Загрузка…»). */
function CardSkeleton({ preview }: { preview: TaskListItem | null }) {
  const { me } = useCabinet();
  return (
    <div className="grid gap-4" aria-busy="true" aria-label={t("app.loading")}>
      <Card className="grid gap-4 p-5 sm:p-6">
        {preview ? (
          <>
            <div className="flex items-center gap-2">
              <StatusPill status={preview.status} />
              <span className="text-sm text-muted-foreground">#{preview.number}</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight break-anywhere">{preview.title}</h2>
            <div className="flex flex-wrap gap-1.5">
              <PickerChip>
                <Avatar name={preview.assignee.displayName} size={20} />
                {preview.assignee.displayName}
              </PickerChip>
              <DueText dueAt={preview.dueAt} overdue={preview.overdue} timeZone={me.company.timezone} />
            </div>
          </>
        ) : (
          <>
            <Skeleton className="h-6 w-28 rounded-full" />
            <Skeleton className="h-8 w-3/4 rounded-lg" />
            <Skeleton className="h-8 w-64 rounded-full" />
          </>
        )}
        <Skeleton className="h-12 w-full rounded-xl sm:w-56" />
      </Card>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

const PRIMARY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  status_changed: Play,
  submitted: Send,
  accepted: Check,
  returned: RotateCcw,
  reopened: RotateCcw,
};

function TaskView({ card }: { card: TaskCard }) {
  const { me } = useCabinet();
  const toast = useToast();
  const setCard = React.useCallback((c: TaskCard) => applyCard(c, me.user.id), [me.user.id]);
  const act = useTaskAction(setCard);
  const [statusDialog, setStatusDialog] = React.useState<TransitionInfo | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [celebrate, setCelebrate] = React.useState(false);
  const task = card.task;
  const canEdit = card.permissions.edit;
  const assignees = useAssignees(task.branchId, canEdit);
  const tz = me.company.timezone;

  const primary = card.transitions.find((tr) => tr.to === card.primary) ?? null;
  const others = card.transitions.filter((tr) => tr !== primary);

  const onError = React.useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code === "version_conflict") toast(t("tasks.card.conflict"), "danger");
      else toast(errorText(e instanceof ApiError ? e.code : "network"), "danger");
    },
    [toast],
  );

  const afterStatus = (next: TaskCard) => {
    if (next.task.status.category === "done") {
      setCelebrate(true);
      window.setTimeout(() => setCelebrate(false), 1600);
    }
    toast(next.replayed ? t("tasks.card.replayed") : t("tasks.card.statusNow", { status: next.task.status.name }));
  };

  /** Изменение одного поля — сохраняется сразу, без отдельной кнопки. */
  const patch = async (body: Record<string, unknown>, message = t("settings.saved")) => {
    try {
      await act("PATCH", `/api/tasks/${task.id}`, body, task.version);
      toast(message);
      return true;
    } catch (e) {
      onError(e);
      return false;
    }
  };

  const runTransition = async (tr: TransitionInfo) => {
    if (busy) return;
    if (tr.requires.comment || tr.requires.result) {
      setStatusDialog(tr);
      return;
    }
    setBusy(true);
    try {
      afterStatus(await act("POST", `/api/tasks/${task.id}/status`, { to: tr.to }, task.version));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      afterStatus(await act("POST", `/api/tasks/${task.id}/restore`, {}, task.version));
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  const cat = task.cancelledAt ? "cancelled" : task.status.category;
  const tint = cat === "done" ? "var(--am-success)" : cat === "review" ? "var(--am-warning)" : task.overdue ? "var(--am-danger)" : "var(--am-accent)";
  const doneItems = task.checklist.filter((i) => i.done).length;

  return (
    <div className="grid gap-4">
      {/* Главное: статус, название, исполнитель и срок, одно основное действие. */}
      <Card className="rise-in relative overflow-hidden p-0">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 transition-[background] duration-500"
          style={{
            background: `radial-gradient(90% 140% at 100% 0%, color-mix(in oklab, ${tint} 13%, transparent), transparent 60%)`,
          }}
        />
        <div className="relative grid gap-4 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <StatusPill
              key={`${task.status.key}-${task.cancelledAt ?? ""}`}
              status={task.status}
              cancelledName={task.cancelledAt ? me.cancelledName : null}
              className="pop"
            />
            <span className="text-sm text-muted-foreground">#{task.number}</span>
            {task.branchName ? <span className="truncate text-sm text-muted-foreground">· {task.branchName}</span> : null}
            <MoreMenu
              others={others}
              category={task.status.category}
              onTransition={(tr) => void runTransition(tr)}
              canCancel={card.permissions.cancel && !task.cancelledAt}
              canRestore={card.permissions.cancel && Boolean(task.cancelledAt)}
              onCancel={() => setCancelling(true)}
              onRestore={() => void restore()}
            />
          </div>

          <EditableTitle value={task.title} editable={canEdit} onSave={(title) => patch({ title })} />

          <div className="flex flex-wrap items-center gap-1.5">
            {canEdit ? (
              <AssigneePicker
                assignees={assignees}
                value={task.assignee.id}
                fallbackName={task.assignee.displayName ?? "—"}
                onChange={(assigneeId) => assigneeId !== task.assignee.id && void patch({ assigneeId })}
              />
            ) : (
              <PickerChip className="cursor-default active:scale-100">
                <Avatar name={task.assignee.displayName ?? "?"} size={20} />
                {task.assignee.id === me.user.id ? t("tasks.quick.me") : task.assignee.displayName}
              </PickerChip>
            )}
            {canEdit ? (
              <DuePicker
                date={task.dueDate ?? ""}
                time={task.dueDate ? (task.dueTime ?? "") : ""}
                overdue={task.overdue}
                label={task.dueAt ? undefined : t("tasks.quick.noDue")}
                onChange={(dueDate, dueTime) =>
                  void patch({
                    dueDate: dueDate || null,
                    dueTime: dueDate && dueTime ? dueTime : null,
                  })
                }
              />
            ) : (
              <span className="px-1">
                <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={tz} />
              </span>
            )}
            {task.requiresResult || task.requiresAttachment ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[13px] font-semibold text-foreground/65">
                <Paperclip className="size-3.5" />
                {task.requiresAttachment ? t("tasks.card.needsFile") : t("tasks.card.needsResult")}
              </span>
            ) : null}
          </div>

          <PrimaryArea
            card={card}
            primary={primary}
            busy={busy}
            celebrate={celebrate}
            onRun={() => primary && void runTransition(primary)}
            onRestore={card.permissions.cancel && task.cancelledAt ? () => void restore() : undefined}
          />
        </div>
      </Card>

      {/* Подробности — раскрываются по нажатию. */}
      <Card className="rise-in overflow-hidden" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="divide-y divide-border">
          <Fold
            icon={FileText}
            title={t("tasks.form.description")}
            summary={task.description ? task.description.split("\n")[0]! : canEdit ? t("tasks.card.addDescription") : t("tasks.card.noDescription")}
          >
            <DescriptionEditor card={card} onSave={(body) => patch(body)} />
          </Fold>
          {canEdit || task.checklist.length ? (
            <Fold
              icon={ListChecks}
              title={t("tasks.card.checklist")}
              summary={
                task.checklist.length
                  ? t("tasks.card.checklistSummary", {
                      done: doneItems,
                      total: task.checklist.length,
                    })
                  : t("tasks.card.checklistEmpty")
              }
              aside={task.checklist.length ? <Progress value={doneItems / task.checklist.length} /> : null}
            >
              <ChecklistEditor card={card} setCard={setCard} act={act} onError={onError} />
            </Fold>
          ) : null}
          <Fold
            icon={Paperclip}
            title={t("tasks.card.attachments")}
            summary={card.attachments.length ? t("tasks.card.filesCount", { n: card.attachments.length }) : t("tasks.card.noAttachments")}
          >
            <FilesSection card={card} setCard={setCard} onError={onError} />
          </Fold>
          <Fold
            icon={MessageSquare}
            title={t("tasks.card.comments")}
            summary={card.comments.length ? `${card.comments.at(-1)!.author}: ${card.comments.at(-1)!.body}` : t("tasks.card.noComments")}
            count={card.comments.length}
          >
            <CommentsSection card={card} act={act} onError={onError} />
          </Fold>
          <Fold icon={History} title={t("tasks.card.historyTitle")} summary={t("tasks.card.historySummary", { n: card.history.length })}>
            <HistoryList card={card} />
          </Fold>
        </div>
      </Card>

      <p className="px-1 text-[13px] text-muted-foreground">
        {t("tasks.card.createdBy", {
          name: task.creator.displayName ?? "—",
          date: formatShortDateTime(task.createdAt, tz),
        })}
      </p>

      <StatusDialog
        card={card}
        transition={statusDialog}
        open={Boolean(statusDialog)}
        onOpenChange={(o) => !o && setStatusDialog(null)}
        act={act}
        setCard={setCard}
        onDone={afterStatus}
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
                onClick={async () => {
                  setBusy(true);
                  try {
                    afterStatus(await act("POST", `/api/tasks/${task.id}/cancel`, {}, task.version));
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                    setCancelling(false);
                  }
                }}
              >
                {t("tasks.card.cancel")}
              </Button>
            </>
          }
        >
          <p className="text-[15px] font-semibold break-anywhere">{task.title}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Одна большая кнопка — следующий шаг по задаче. Нет шага — понятное состояние. */
function PrimaryArea({
  card,
  primary,
  busy,
  celebrate,
  onRun,
  onRestore,
}: {
  card: TaskCard;
  primary: TransitionInfo | null;
  busy: boolean;
  celebrate: boolean;
  onRun: () => void;
  onRestore?: () => void;
}) {
  const { me } = useCabinet();
  const task = card.task;
  if (task.cancelledAt) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/70 p-3.5">
        <XCircle className="size-5 text-muted-foreground" />
        <span className="flex-1 text-sm font-semibold text-foreground/75">{t("tasks.card.cancelledState")}</span>
        {onRestore ? (
          <Button variant="outline" disabled={busy} onClick={onRestore}>
            <RotateCcw />
            {t("tasks.card.restore")}
          </Button>
        ) : null}
      </div>
    );
  }
  if (primary) {
    const Icon = PRIMARY_ICON[primary.kind] ?? Play;
    const done = me.statuses.find((s) => s.key === primary.to)?.category === "done";
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          key={primary.to}
          size="lg"
          disabled={busy}
          onClick={onRun}
          className={cn(
            "pop h-12 w-full gap-2 rounded-xl text-[15px] shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] sm:w-auto sm:min-w-60",
            done && "bg-success hover:bg-success/90",
          )}
        >
          {busy ? <Spinner /> : <Icon className="size-[18px]" />}
          {transitionLabel(primary, task.status.category)}
        </Button>
        {primary.requires.result ? <span className="text-[13px] text-muted-foreground">{t("tasks.card.resultHint")}</span> : null}
      </div>
    );
  }
  const cat = task.status.category;
  const state = cat === "done" ? "done" : cat === "review" ? "review" : "none";
  const Icon = state === "done" ? CheckCircle2 : state === "review" ? Eye : Check;
  return (
    <div
      key={task.status.key}
      className={cn(
        "card-in flex items-center gap-3 rounded-xl p-3.5",
        state === "done" ? "bg-success/10 text-success" : state === "review" ? "bg-warning/10 text-warning" : "bg-muted/70 text-foreground/70",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full",
          state === "done" ? "bg-success text-white" : state === "review" ? "bg-warning/15" : "bg-surface",
          celebrate && "pop burst",
        )}
      >
        <Icon className="size-5" />
      </span>
      <span className="text-[15px] font-semibold">
        {state === "none" && task.assignee.id !== me.user.id ? t("tasks.card.state.waiting", { name: task.assignee.displayName ?? "—" }) : t(`tasks.card.state.${state}`)}
      </span>
    </div>
  );
}

function MoreMenu({
  others,
  category,
  onTransition,
  canCancel,
  canRestore,
  onCancel,
  onRestore,
}: {
  others: TransitionInfo[];
  category: string;
  onTransition: (tr: TransitionInfo) => void;
  canCancel: boolean;
  canRestore: boolean;
  onCancel: () => void;
  onRestore: () => void;
}) {
  if (!others.length && !canCancel && !canRestore) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="ml-auto inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2 text-[13px] font-semibold text-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
        aria-label={t("tasks.card.moreActions")}
      >
        <MoreHorizontal className="size-5" />
        <span className="hidden sm:inline">{t("tasks.card.moreActions")}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="card-in z-50 min-w-60 rounded-xl border border-border bg-surface p-1 shadow-xl">
          {others.map((tr) => (
            <DropdownMenu.Item
              key={tr.to}
              onSelect={() => onTransition(tr)}
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-semibold outline-none data-[highlighted]:bg-muted"
            >
              {transitionLabel(tr, category)}
            </DropdownMenu.Item>
          ))}
          {others.length && (canCancel || canRestore) ? <DropdownMenu.Separator className="my-1 h-px bg-border" /> : null}
          {canRestore ? (
            <DropdownMenu.Item
              onSelect={onRestore}
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-semibold outline-none data-[highlighted]:bg-muted"
            >
              {t("tasks.card.restore")}
            </DropdownMenu.Item>
          ) : null}
          {canCancel ? (
            <DropdownMenu.Item
              onSelect={onCancel}
              className="cursor-pointer rounded-lg px-3 py-2.5 text-sm font-semibold text-danger outline-none data-[highlighted]:bg-danger/5"
            >
              {t("tasks.card.cancel")}
            </DropdownMenu.Item>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Название: нажатие — поле ввода, Enter сохраняет, Esc отменяет. */
function EditableTitle({ value, editable, onSave }: { value: string; editable: boolean; onSave: (v: string) => Promise<boolean> }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      setEditing(false);
      setDraft(value);
      return;
    }
    if (await onSave(next)) setEditing(false);
  };
  if (!editable) return <h2 className="text-2xl font-bold tracking-tight break-anywhere">{value}</h2>;
  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        rows={1}
        maxLength={300}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setDraft(value);
            setEditing(false);
          }
        }}
        aria-label={t("tasks.form.title")}
        className="card-in field-sizing-content w-full resize-none rounded-xl border border-primary/40 bg-surface px-3 py-1.5 text-2xl font-bold tracking-tight shadow-[0_0_0_3px_color-mix(in_oklab,var(--am-accent)_14%,transparent)] outline-none"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title={t("tasks.card.editTitle")}
      className="group -mx-2 flex w-[calc(100%+1rem)] cursor-text items-start gap-2 rounded-xl px-2 py-0.5 text-left transition-colors hover:bg-muted/70"
    >
      <span className="min-w-0 flex-1 text-2xl font-bold tracking-tight break-anywhere">{value}</span>
      <Pencil className="mt-2 size-4 shrink-0 text-foreground/30 opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/** Раскрывающийся раздел: заголовок и краткое содержание, по нажатию — подробности. */
function Fold({
  icon: Icon,
  title,
  summary,
  aside,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  summary: string;
  aside?: React.ReactNode;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cn("flex w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 sm:px-5", open && "bg-muted/30")}
      >
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl transition-colors",
            open ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[15px] font-bold">
            {title}
            {count ? <span className="pop rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">{count}</span> : null}
          </span>
          {!open ? <span className="block truncate text-[13px] text-muted-foreground">{summary}</span> : null}
        </span>
        {aside}
        <ChevronDown className={cn("size-5 shrink-0 text-foreground/40 transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div id={id} className={cn("grid transition-[grid-template-rows] duration-300 ease-out", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="min-h-0 overflow-hidden">
          <div className={cn("px-4 pb-5 pt-1 transition-opacity duration-300 sm:px-5 sm:pl-[4.25rem]", open ? "opacity-100" : "opacity-0")}>
            {open ? children : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
      <span className="block h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${Math.round(value * 100)}%` }} />
    </span>
  );
}

function DescriptionEditor({ card, onSave }: { card: TaskCard; onSave: (body: Record<string, unknown>) => Promise<boolean> }) {
  const task = card.task;
  const canEdit = card.permissions.edit;
  const [editing, setEditing] = React.useState(false);
  const [description, setDescription] = React.useState(task.description ?? "");
  const [criteria, setCriteria] = React.useState(task.resultCriteria ?? "");
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    if (!editing) {
      setDescription(task.description ?? "");
      setCriteria(task.resultCriteria ?? "");
    }
  }, [task.description, task.resultCriteria, editing]);

  if (editing) {
    return (
      <form
        className="card-in grid gap-3"
        onKeyDown={onSubmitShortcut}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const ok = await onSave({
            description: description.trim() || null,
            resultCriteria: criteria.trim() || null,
          });
          setSaving(false);
          if (ok) setEditing(false);
        }}
      >
        <Textarea
          autoFocus
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          maxLength={10000}
          placeholder={t("tasks.quick.descriptionPlaceholder")}
          aria-label={t("tasks.form.description")}
        />
        <Textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder={t("tasks.form.resultCriteriaHint")}
          aria-label={t("tasks.form.resultCriteria")}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <Spinner /> : null}
            {t("app.save")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t("app.cancel")}
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="grid gap-3">
      <p className={cn("whitespace-pre-wrap text-[15px] leading-relaxed break-anywhere", !task.description && "text-muted-foreground")}>
        {task.description || t("tasks.card.noDescription")}
      </p>
      {task.resultCriteria ? (
        <div className="rounded-xl bg-success/8 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-success">{t("tasks.form.resultCriteria")}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm break-anywhere">{task.resultCriteria}</p>
        </div>
      ) : null}
      {canEdit ? (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setEditing(true)}>
          <Pencil />
          {t("tasks.card.edit")}
        </Button>
      ) : null}
    </div>
  );
}

function ChecklistEditor({
  card,
  setCard,
  act,
  onError,
}: {
  card: TaskCard;
  setCard: (c: TaskCard) => void;
  act: ReturnType<typeof useTaskAction>;
  onError: (e: unknown) => void;
}) {
  const [text, setText] = React.useState("");
  const [popped, setPopped] = React.useState<string | null>(null);
  const items = card.task.checklist;
  const canToggle = card.permissions.checklist && !card.task.cancelledAt;
  const canEdit = card.permissions.edit;

  // Отметка видна сразу; сервер подтверждает в фоне.
  const save = async (checklist: ChecklistItem[]) => {
    setCard({ ...card, task: { ...card.task, checklist } });
    try {
      await act("PATCH", `/api/tasks/${card.task.id}`, { checklist }, card.task.version);
    } catch (e) {
      onError(e);
    }
  };
  const add = () => {
    const value = text.trim();
    if (!value) return;
    void save([...items, { id: crypto.randomUUID().slice(0, 8), text: value, done: false }]);
    setText("");
  };

  return (
    <div className="grid gap-2">
      {items.length ? (
        <ul className="grid gap-0.5">
          {items.map((item) => (
            <li key={item.id} className="card-in group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50">
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done}
                disabled={!canToggle}
                onClick={() => {
                  if (!item.done) setPopped(item.id);
                  void save(items.map((c) => (c.id === item.id ? { ...c, done: !c.done } : c)));
                }}
                className={cn(
                  "grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-md border-2 transition-all duration-200 active:scale-90 disabled:cursor-default",
                  item.done ? "border-success bg-success text-white" : "border-foreground/25 hover:border-success",
                  popped === item.id && item.done && "pop burst",
                )}
                aria-label={item.text}
              >
                {item.done ? <Check className="size-3.5" strokeWidth={3} /> : null}
              </button>
              <span className={cn("min-w-0 flex-1 text-[15px] transition-colors break-anywhere", item.done && "text-muted-foreground line-through")}>
                {item.text}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  className="cursor-pointer rounded-md p-1 text-foreground/40 opacity-0 transition-opacity hover:bg-muted hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`${t("tasks.card.removeItem")}: ${item.text}`}
                  onClick={() => void save(items.filter((c) => c.id !== item.id))}
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canEdit ? (
        <form
          className="flex items-center gap-2 rounded-lg border border-dashed border-border px-2 focus-within:border-primary/50"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Plus className="size-4 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("tasks.card.newItem")}
            aria-label={t("tasks.card.newItem")}
            maxLength={300}
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:outline-none"
          />
          {text.trim() ? (
            <Button type="submit" size="sm" className="pop">
              {t("tasks.card.addItem")}
            </Button>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function FilesSection({ card, setCard, onError }: { card: TaskCard; setCard: (c: TaskCard) => void; onError: (e: unknown) => void }) {
  const { me } = useCabinet();
  return (
    <div className="grid gap-3">
      {card.attachments.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {card.attachments.map((a) => (
            <li key={a.id} className="card-in flex items-center gap-3 rounded-xl border border-border p-2">
              {a.contentType.startsWith("image/") ? (
                <img src={`/api/attachments/${a.id}`} alt="" loading="lazy" className="size-12 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <FileText className="size-5" />
                </span>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener" className="block truncate font-semibold text-primary hover:underline">
                  {a.fileName}
                </a>
                <p className="truncate text-xs text-muted-foreground">
                  {formatSize(a.size)} · {a.uploader} · {formatShortDateTime(a.createdAt, me.company.timezone)}
                </p>
              </div>
              {a.canDelete ? (
                <button
                  type="button"
                  className="cursor-pointer rounded-lg p-2 text-foreground/50 hover:bg-muted hover:text-danger"
                  aria-label={`${t("tasks.card.deleteFile")}: ${a.fileName}`}
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/attachments/${a.id}`, {
                        method: "DELETE",
                        credentials: "same-origin",
                      });
                      const data = await res.json().catch(() => null);
                      if (!res.ok) throw new ApiError(data?.error?.code ?? "internal", res.status, null);
                      setCard({
                        ...card,
                        attachments: card.attachments.filter((x) => x.id !== a.id),
                      });
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
      {card.permissions.attach ? <AttachButtons taskId={card.task.id} onUploaded={setCard} /> : null}
    </div>
  );
}

function CommentsSection({ card, act, onError }: { card: TaskCard; act: ReturnType<typeof useTaskAction>; onError: (e: unknown) => void }) {
  const { me } = useCabinet();
  const [body, setBody] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await act("POST", `/api/tasks/${card.task.id}/comments`, { body: text });
      setBody("");
    } catch (e) {
      onError(e);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="grid gap-3">
      {card.comments.length ? (
        <ul className="grid gap-2.5">
          {card.comments.map((c) => (
            <li key={c.id} className="card-in flex gap-2.5">
              <Avatar name={c.author ?? "?"} size={30} />
              <div
                className={cn(
                  "min-w-0 flex-1 rounded-[4px_16px_16px_16px] border px-3.5 py-2.5",
                  c.kind === "result" ? "border-success/30 bg-success/5" : c.kind === "return" ? "border-warning/30 bg-warning/5" : "border-border bg-muted/40",
                )}
              >
                <p className="mb-0.5 text-[12px] text-muted-foreground">
                  <span className="font-semibold text-foreground/80">{c.author}</span>
                  {c.kind !== "comment" ? <span className="font-semibold"> · {t(`tasks.card.commentKinds.${c.kind}`)}</span> : null} ·{" "}
                  {formatShortDateTime(c.createdAt, me.company.timezone)}
                </p>
                <p className="whitespace-pre-wrap text-[15px] break-anywhere">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="flex items-end gap-2 rounded-2xl border border-border bg-surface p-1.5 focus-within:border-primary/50"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          maxLength={10000}
          placeholder={t("tasks.card.commentPlaceholder")}
          aria-label={t("tasks.card.commentPlaceholder")}
          className="field-sizing-content max-h-40 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={!body.trim() || sending}
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl bg-primary text-primary-foreground transition-all active:scale-90 disabled:opacity-40"
          aria-label={t("tasks.card.commentSend")}
        >
          {sending ? <Spinner /> : <SendHorizontal className="size-4" />}
        </button>
      </form>
    </div>
  );
}

function HistoryList({ card }: { card: TaskCard }) {
  const { me } = useCabinet();
  return (
    <ol className="relative grid gap-3 border-l-2 border-border pl-4">
      {card.history.map((h) => (
        <li key={h.id} className="relative text-sm">
          <span aria-hidden className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-primary/60" />
          <p className="break-anywhere">{historyText(h)}</p>
          {h.comment ? <p className="whitespace-pre-wrap text-foreground/75 break-anywhere">«{h.comment}»</p> : null}
          <p className="text-xs text-muted-foreground">
            {h.actor} · {formatShortDateTime(h.createdAt, me.company.timezone)}
          </p>
        </li>
      ))}
    </ol>
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
    const month = new Intl.DateTimeFormat("ru-RU", {
      month: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y, m - 1, d)));
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
