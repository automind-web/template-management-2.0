"use client";

import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { useSubmit } from "@/components/forms";
import { Button, Kbd } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Checkbox, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { onSubmitShortcut, useSubmitShortcutLabel } from "@/lib/hotkeys";
import { t } from "@/lib/i18n";
import { newOpId } from "@/lib/op";
import type { Assignee, TaskCard } from "./types";

/** Кому участник может назначить задачу в филиале (или «all» — для фильтра директора). */
export function useAssignees(branchId: string | null, enabled = true) {
  const [list, setList] = React.useState<Assignee[] | null>(null);
  React.useEffect(() => {
    if (!branchId || !enabled) return;
    const ctrl = new AbortController();
    setList(null);
    api<{ assignees: Assignee[] }>("GET", `/api/tasks/assignees?branch=${encodeURIComponent(branchId)}`, undefined, { signal: ctrl.signal })
      .then((r) => setList(r.assignees))
      .catch(() => {});
    return () => ctrl.abort();
  }, [branchId, enabled]);
  return list;
}

export function assigneeLabel(a: Assignee): string {
  return a.self ? t("tasks.form.assigneeSelf", { name: a.displayName }) : a.displayName;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (card: TaskCard) => void;
}) {
  const { me, concreteBranchId } = useCabinet();
  const [branchId, setBranch] = React.useState(concreteBranchId ?? "");
  const assignees = useAssignees(branchId || null, open);
  const [title, setTitle] = React.useState("");
  const [assigneeId, setAssignee] = React.useState(me.user.id);
  const [dueDate, setDue] = React.useState("");
  const [dueTime, setDueTime] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [resultCriteria, setCriteria] = React.useState("");
  const [requiresResult, setRequiresResult] = React.useState(companyConfig.rules.defaultRequiresResult);
  const [requiresAttachment, setRequiresAttachment] = React.useState(companyConfig.rules.defaultRequiresAttachment);
  // Один opId на попытку создания: повторное нажатие не создаст вторую задачу.
  const opId = React.useRef(newOpId());
  const shortcut = useSubmitShortcutLabel();

  React.useEffect(() => {
    if (open && concreteBranchId) setBranch((b) => b || concreteBranchId);
  }, [open, concreteBranchId]);
  // Исполнитель другого филиала сбрасывается на «я».
  React.useEffect(() => {
    if (assignees && !assignees.some((a) => a.userId === assigneeId)) setAssignee(me.user.id);
  }, [assignees, assigneeId, me.user.id]);

  const reset = () => {
    setTitle("");
    setAssignee(me.user.id);
    setDue("");
    setDueTime("");
    setDescription("");
    setCriteria("");
    setRequiresResult(companyConfig.rules.defaultRequiresResult);
    setRequiresAttachment(companyConfig.rules.defaultRequiresAttachment);
    opId.current = newOpId();
  };

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const card = await api<TaskCard>("POST", "/api/tasks", {
      opId: opId.current,
      branchId: branchId || null,
      title,
      assigneeId,
      dueDate: dueDate || null,
      dueTime: dueDate && dueTime ? dueTime : null,
      description: description || null,
      resultCriteria: resultCriteria || null,
      requiresResult,
      requiresAttachment,
    });
    reset();
    onOpenChange(false);
    onCreated(card);
  });

  const formId = "create-task-form";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("tasks.form.newTitle")}
        footer={
          <>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("app.cancel")}
            </Button>
            <Button type="submit" form={formId} disabled={pending || !branchId}>
              {pending ? <Spinner /> : null}
              {t("tasks.form.create")}
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
          <Field label={t("tasks.form.title")} error={fieldErrors.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("tasks.form.branch")} error={fieldErrors.branchId}>
              <NativeSelect value={branchId} onChange={(e) => setBranch(e.target.value)} disabled={me.branches.length <= 1} required>
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
            <Field label={t("tasks.form.assignee")} error={fieldErrors.assigneeId}>
              <NativeSelect value={assigneeId} onChange={(e) => setAssignee(e.target.value)} disabled={!assignees || assignees.length <= 1}>
                {(assignees ?? [{ userId: me.user.id, displayName: me.user.displayName, role: me.role, self: true }]).map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {assigneeLabel(a)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("tasks.form.dueDate")} error={fieldErrors.dueDate}>
              <Input type="date" value={dueDate} onChange={(e) => setDue(e.target.value)} />
            </Field>
            <Field label={t("tasks.form.dueTime")} hint={dueDate && !dueTime ? t("tasks.form.dueTimeHint", { time: me.dueTime }) : undefined} error={fieldErrors.dueTime}>
              <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} disabled={!dueDate} />
            </Field>
          </div>
          <Field label={t("tasks.form.description")} error={fieldErrors.description}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={10000} />
          </Field>
          <Field label={t("tasks.form.resultCriteria")} error={fieldErrors.resultCriteria}>
            <Textarea
              value={resultCriteria}
              onChange={(e) => setCriteria(e.target.value)}
              rows={3}
              maxLength={5000}
              placeholder={t("tasks.form.resultCriteriaHint")}
            />
          </Field>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Checkbox label={t("tasks.form.requiresResult")} checked={requiresResult} onChange={(e) => setRequiresResult(e.target.checked)} />
            <Checkbox label={t("tasks.form.requiresAttachment")} checked={requiresAttachment} onChange={(e) => setRequiresAttachment(e.target.checked)} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
