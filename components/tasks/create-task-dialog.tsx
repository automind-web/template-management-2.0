"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { useSubmit } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/input";
import { companyConfig } from "@/config/company";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import { newOpId } from "@/lib/op";
import type { Assignee, ChecklistItem, TaskCard } from "./types";

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

export function ChecklistEditor({ items, onChange }: { items: ChecklistItem[]; onChange: (items: ChecklistItem[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{t("tasks.form.checklist")}</Label>
      {items.map((item, i) => (
        <div key={item.id} className="flex gap-2">
          <Input
            value={item.text}
            placeholder={t("tasks.form.checklistPlaceholder")}
            aria-label={`${t("tasks.form.checklist")} ${i + 1}`}
            maxLength={300}
            onChange={(e) => onChange(items.map((it) => (it.id === item.id ? { ...it, text: e.target.value } : it)))}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("tasks.form.checklistRemove")}
            onClick={() => onChange(items.filter((it) => it.id !== item.id))}
          >
            <X />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, { id: crypto.randomUUID().slice(0, 8), text: "", done: false }])}
        >
          <Plus />
          {t("tasks.form.checklistAdd")}
        </Button>
      </div>
    </div>
  );
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
  const { me, branchId } = useCabinet();
  const assignees = useAssignees(branchId, open);
  const [title, setTitle] = React.useState("");
  const [assigneeId, setAssignee] = React.useState(me.user.id);
  const [dueDate, setDue] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [resultCriteria, setCriteria] = React.useState("");
  const [checklist, setChecklist] = React.useState<ChecklistItem[]>([]);
  const [requiresResult, setRequiresResult] = React.useState(companyConfig.rules.defaultRequiresResult);
  const [requiresAttachment, setRequiresAttachment] = React.useState(companyConfig.rules.defaultRequiresAttachment);
  // Один opId на одну попытку создания: повторное нажатие не создаст вторую задачу.
  const opId = React.useRef(newOpId());

  const reset = () => {
    setTitle("");
    setAssignee(me.user.id);
    setDue("");
    setDescription("");
    setCriteria("");
    setChecklist([]);
    setRequiresResult(companyConfig.rules.defaultRequiresResult);
    setRequiresAttachment(companyConfig.rules.defaultRequiresAttachment);
    opId.current = newOpId();
  };

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const card = await api<TaskCard>("POST", "/api/tasks", {
      opId: opId.current,
      branchId,
      title,
      assigneeId,
      dueDate: dueDate || null,
      description: description || null,
      resultCriteria: resultCriteria || null,
      checklist: checklist.filter((c) => c.text.trim()).map((c) => ({ ...c, text: c.text.trim() })),
      requiresResult,
      requiresAttachment,
    });
    reset();
    onOpenChange(false);
    onCreated(card);
  });

  const branchName = me.branches.find((b) => b.id === branchId)?.name ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("tasks.create")} description={t("tasks.form.branch", { name: branchName })}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t("tasks.form.title")} error={fieldErrors.title}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus />
          </Field>
          <Field label={t("tasks.form.assignee")} error={fieldErrors.assigneeId}>
            <NativeSelect value={assigneeId} onChange={(e) => setAssignee(e.target.value)} disabled={!assignees || assignees.length <= 1}>
              {(assignees ?? [{ userId: me.user.id, displayName: me.user.displayName, role: me.role, self: true }]).map((a) => (
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
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={10000} />
          </Field>
          <Field label={t("tasks.form.resultCriteria")} hint={t("tasks.form.resultCriteriaHint")} error={fieldErrors.resultCriteria}>
            <Textarea value={resultCriteria} onChange={(e) => setCriteria(e.target.value)} rows={2} maxLength={5000} />
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
            <Button type="submit" disabled={pending || !branchId}>
              {pending ? <Spinner /> : null}
              {t("tasks.form.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
