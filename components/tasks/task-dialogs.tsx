"use client";

import { Paperclip } from "lucide-react";
import * as React from "react";
import { useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { errorText, t } from "@/lib/i18n";
import { ChecklistEditor, useAssignees } from "./create-task-dialog";
import { transitionLabel } from "./labels";
import type { TaskCard, TransitionInfo } from "./types";
import type { useTaskAction } from "./use-task";

type Act = ReturnType<typeof useTaskAction>;

const CONFLICT = () => t("tasks.card.conflict");

/** Загрузка файла к задаче. */
export function AttachButton({ taskId, onUploaded, label }: { taskId: string; onUploaded: (card: TaskCard) => void; label?: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt,.zip"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const form = new FormData();
            form.set("file", file);
            form.set("kind", file.type.startsWith("image/") ? "photo" : "file");
            const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form, credentials: "same-origin" });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new ApiError(data?.error?.code ?? "internal", res.status, null);
            onUploaded(data as TaskCard);
          } catch (err) {
            setError(errorText(err instanceof ApiError ? err.code : "network"));
          } finally {
            setBusy(false);
          }
        }}
      />
      <div>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? <Spinner /> : <Paperclip />}
          {busy ? t("tasks.card.uploading") : (label ?? t("tasks.card.attach"))}
        </Button>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

/** Форма перехода, если нужен результат или комментарий. Та же форма используется и при перетаскивании (этап 3). */
export function StatusDialog({
  card,
  transition,
  open,
  onOpenChange,
  act,
  onDone,
  setCard,
}: {
  card: TaskCard;
  transition: TransitionInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  act: Act;
  onDone: (card: TaskCard) => void;
  setCard: (card: TaskCard) => void;
}) {
  const [result, setResult] = React.useState("");
  const [comment, setComment] = React.useState("");
  const { run, pending, error, fieldErrors, setError } = useSubmit(async () => {
    if (!transition) return;
    try {
      const next = await act(
        "POST",
        `/api/tasks/${card.task.id}/status`,
        { to: transition.to, result: result || null, comment: comment || null },
        card.task.version,
      );
      setResult("");
      setComment("");
      onOpenChange(false);
      onDone(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        setError(CONFLICT());
        return;
      }
      throw e;
    }
  });

  if (!transition) return null;
  const needsFile = transition.requires.attachment && card.attachments.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={transitionLabel(transition, card.task.status.category)} description={card.task.title}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {transition.requires.result ? (
            <Field label={t("tasks.statusForm.result")} hint={t("tasks.statusForm.resultHint")} error={fieldErrors.result}>
              <Textarea value={result} onChange={(e) => setResult(e.target.value)} rows={4} required={transition.requires.resultText} autoFocus />
            </Field>
          ) : null}
          {transition.requires.result ? (
            <div className="flex flex-col gap-2">
              {needsFile ? <p className="text-sm text-destructive">{t("tasks.statusForm.attachmentRequired")}</p> : null}
              {card.attachments.length ? (
                <ul className="text-xs text-muted-foreground">
                  {card.attachments.map((a) => (
                    <li key={a.id} className="truncate">
                      📎 {a.fileName}
                    </li>
                  ))}
                </ul>
              ) : null}
              <AttachButton taskId={card.task.id} onUploaded={setCard} />
            </div>
          ) : null}
          <Field
            label={transition.requires.comment ? t("tasks.statusForm.commentRequired") : t("tasks.statusForm.comment")}
            error={fieldErrors.comment}
          >
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              required={transition.requires.comment}
              autoFocus={!transition.requires.result}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" disabled={pending || needsFile}>
              {pending ? <Spinner /> : null}
              {t("tasks.statusForm.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Изменение полей задачи (постановщик, руководитель, директор). */
export function EditTaskDialog({
  card,
  open,
  onOpenChange,
  act,
  onSaved,
}: {
  card: TaskCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  act: Act;
  onSaved: (card: TaskCard) => void;
}) {
  const task = card.task;
  const assignees = useAssignees(task.branchId, open);
  const [title, setTitle] = React.useState(task.title);
  const [assigneeId, setAssignee] = React.useState(task.assignee.id);
  const [dueDate, setDue] = React.useState(task.dueDate ?? "");
  const [description, setDescription] = React.useState(task.description ?? "");
  const [resultCriteria, setCriteria] = React.useState(task.resultCriteria ?? "");
  const [checklist, setChecklist] = React.useState(task.checklist);
  const [requiresResult, setRequiresResult] = React.useState(task.requiresResult);
  const [requiresAttachment, setRequiresAttachment] = React.useState(task.requiresAttachment);

  // Открытие формы берёт актуальные значения; при конфликте введённое остаётся.
  React.useEffect(() => {
    if (!open) return;
    setTitle(task.title);
    setAssignee(task.assignee.id);
    setDue(task.dueDate ?? "");
    setDescription(task.description ?? "");
    setCriteria(task.resultCriteria ?? "");
    setChecklist(task.checklist);
    setRequiresResult(task.requiresResult);
    setRequiresAttachment(task.requiresAttachment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { run, pending, error, fieldErrors, setError } = useSubmit(async () => {
    try {
      const next = await act(
        "PATCH",
        `/api/tasks/${task.id}`,
        {
          title,
          assigneeId,
          dueDate: dueDate || null,
          description: description || null,
          resultCriteria: resultCriteria || null,
          checklist: checklist.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })),
          requiresResult,
          requiresAttachment,
        },
        card.task.version,
      );
      onOpenChange(false);
      onSaved(next);
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        setError(CONFLICT());
        return;
      }
      throw e;
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("tasks.card.edit")}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t("tasks.form.title")} error={fieldErrors.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
          </Field>
          <Field label={t("tasks.form.assignee")} error={fieldErrors.assigneeId}>
            <NativeSelect value={assigneeId} onChange={(e) => setAssignee(e.target.value)} disabled={!assignees}>
              {!assignees || !assignees.some((a) => a.userId === task.assignee.id) ? (
                <option value={task.assignee.id}>{task.assignee.displayName}</option>
              ) : null}
              {(assignees ?? []).map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.self ? t("tasks.form.assigneeSelf", { name: a.displayName }) : `${a.displayName} · ${t(`roles.${a.role}`)}`}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("tasks.form.dueDate")} hint={t("tasks.form.dueHint")} error={fieldErrors.dueDate}>
            <Input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label={t("tasks.form.description")} error={fieldErrors.description}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </Field>
          <Field label={t("tasks.form.resultCriteria")} error={fieldErrors.resultCriteria}>
            <Textarea value={resultCriteria} onChange={(e) => setCriteria(e.target.value)} rows={2} />
          </Field>
          <ChecklistEditor items={checklist} onChange={setChecklist} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4" checked={requiresResult} onChange={(e) => setRequiresResult(e.target.checked)} />
            {t("tasks.form.requiresResult")}
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={requiresAttachment}
              onChange={(e) => setRequiresAttachment(e.target.checked)}
            />
            {t("tasks.form.requiresAttachment")}
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Spinner /> : null}
              {t("app.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
