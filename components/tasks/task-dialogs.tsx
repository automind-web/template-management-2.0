"use client";

import { Camera, Paperclip } from "lucide-react";
import * as React from "react";
import { useSubmit } from "@/components/forms";
import { Button, Kbd } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { onSubmitShortcut, useSubmitShortcutLabel } from "@/lib/hotkeys";
import { errorText, t } from "@/lib/i18n";
import { transitionLabel } from "./labels";
import type { TaskCard, TransitionInfo } from "./types";
import type { useTaskAction } from "./use-task";

type Act = ReturnType<typeof useTaskAction>;

/** Кнопки «Файл» и «Фото» (на телефоне «Фото» открывает камеру). */
export function AttachButtons({ taskId, onUploaded }: { taskId: string; onUploaded: (card: TaskCard) => void }) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const photoRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const upload = async (file: File | undefined) => {
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
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={photoRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Paperclip />
          {t("tasks.card.file")}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => photoRef.current?.click()}>
          <Camera />
          {t("tasks.card.photo")}
        </Button>
        {busy ? (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> {t("tasks.card.uploading")}
          </span>
        ) : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
    </div>
  );
}

/** Форма перехода, если нужен результат или комментарий. Та же форма — из меню карточки и канбана. */
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
  const shortcut = useSubmitShortcutLabel();
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
      // Конфликт: показано актуальное состояние, введённый текст остаётся в форме.
      if (e instanceof ApiError && e.code === "version_conflict") {
        setError(t("tasks.card.conflict"));
        return;
      }
      throw e;
    }
  });

  if (!transition) return null;
  const needsFile = transition.requires.attachment && card.attachments.length === 0;
  const formId = `status-form-${card.task.id}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={transitionLabel(transition, card.task.status.category)}
        description={card.task.title}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" form={formId} disabled={pending || needsFile}>
              {pending ? <Spinner /> : null}
              {t("tasks.statusForm.submit")}
              <Kbd>{shortcut}</Kbd>
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          onKeyDown={onSubmitShortcut}
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {transition.requires.result ? (
            <>
              <Field label={t("tasks.statusForm.result")} hint={t("tasks.statusForm.resultHint")} error={fieldErrors.result}>
                <Textarea value={result} onChange={(e) => setResult(e.target.value)} rows={4} required={transition.requires.resultText} autoFocus />
              </Field>
              <div className="flex flex-col gap-2">
                {needsFile ? <p className="text-sm text-destructive">{t("tasks.statusForm.attachmentRequired")}</p> : null}
                {card.attachments.length ? (
                  <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                    {card.attachments.map((a) => (
                      <li key={a.id} className="truncate">
                        {a.fileName}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <AttachButtons taskId={card.task.id} onUploaded={setCard} />
              </div>
            </>
          ) : null}
          <Field label={transition.requires.comment ? t("tasks.statusForm.commentRequired") : t("tasks.statusForm.comment")} error={fieldErrors.comment}>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              required={transition.requires.comment}
              autoFocus={!transition.requires.result}
            />
          </Field>
        </form>
      </DialogContent>
    </Dialog>
  );
}
