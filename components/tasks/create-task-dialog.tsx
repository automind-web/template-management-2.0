"use client";

import { Building2, ChevronDown, CornerDownLeft, Maximize2, Plus } from "lucide-react";
import { Popover } from "radix-ui";
import * as React from "react";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { useSubmit } from "@/components/forms";
import { Button, Kbd } from "@/components/ui/button";
import { Alert, Card, Spinner } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { companyConfig } from "@/config/company";
import { api, ApiError } from "@/lib/api";
import { onSubmitShortcut, useSubmitShortcutLabel } from "@/lib/hotkeys";
import { errorText, t } from "@/lib/i18n";
import { newOpId } from "@/lib/op";
import { cn } from "@/lib/utils";
import { AssigneePicker, DuePicker, PickerChip } from "./pickers";
import { invalidateLists, itemFromCard, linkKey, prependItem, replaceItem } from "./store";
import type { Assignee, TaskCard, TaskListItem } from "./types";

/** Кому участник может назначить задачу в филиале (или «all» — для фильтра директора). Список кэшируется. */
const assigneeCache = new Map<string, Assignee[]>();
const assigneeTime = new Map<string, number>();
const assigneePending = new Map<string, Promise<{ assignees: Assignee[] }>>();
export function useAssignees(branchId: string | null, enabled = true) {
  const [list, setList] = React.useState<Assignee[] | null>(() => (branchId ? (assigneeCache.get(branchId) ?? null) : null));
  React.useEffect(() => {
    if (!branchId || !enabled) return;
    setList(assigneeCache.get(branchId) ?? null);
    if (Date.now() - (assigneeTime.get(branchId) ?? 0) < 30_000) return;
    let alive = true;
    let pending = assigneePending.get(branchId);
    if (!pending) {
      pending = api<{ assignees: Assignee[] }>("GET", `/api/tasks/assignees?branch=${encodeURIComponent(branchId)}`);
      assigneePending.set(branchId, pending);
      void pending.finally(() => assigneePending.delete(branchId)).catch(() => {});
    }
    pending.then((r) => {
      assigneeCache.set(branchId, r.assignees);
      assigneeTime.set(branchId, Date.now());
      if (alive) setList(r.assignees);
    }).catch(() => {});
    return () => { alive = false; };
  }, [branchId, enabled]);
  return list;
}

export function assigneeLabel(a: Assignee): string {
  return a.self ? t("tasks.form.assigneeSelf", { name: a.displayName }) : a.displayName;
}

type Draft = {
  branchId: string;
  title: string;
  assigneeId: string;
  dueDate: string;
  dueTime: string;
  description: string;
  resultCriteria: string;
  requiresResult: boolean;
  requiresAttachment: boolean;
};

function useDraft() {
  const { me, concreteBranchId } = useCabinet();
  const initial = React.useCallback(
    (): Draft => ({
      branchId: concreteBranchId ?? me.branch?.id ?? me.branches[0]?.id ?? "",
      title: "",
      assigneeId: me.user.id,
      dueDate: "",
      dueTime: "",
      description: "",
      resultCriteria: "",
      requiresResult: companyConfig.rules.defaultRequiresResult,
      requiresAttachment: companyConfig.rules.defaultRequiresAttachment,
    }),
    [concreteBranchId, me],
  );
  const [draft, setDraft] = React.useState<Draft>(initial);
  // Смена филиала в шапке — новый филиал для следующей задачи.
  React.useEffect(() => {
    if (concreteBranchId) setDraft((d) => ({ ...d, branchId: concreteBranchId }));
  }, [concreteBranchId]);
  const assignees = useAssignees(draft.branchId || null);
  // Исполнитель другого филиала сбрасывается на «я».
  React.useEffect(() => {
    if (assignees && !assignees.some((a) => a.userId === draft.assigneeId)) setDraft((d) => ({ ...d, assigneeId: me.user.id }));
  }, [assignees, draft.assigneeId, me.user.id]);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  return { draft, set, setDraft, initial, assignees };
}

/**
 * Создание задачи с мгновенным откликом: строка появляется в списке сразу,
 * а после ответа сервера заменяется настоящей. Один opId на попытку — повтор не создаст дубль.
 */
function useCreate(listQuery: string | null) {
  const { me } = useCabinet();
  return React.useCallback(
    async (draft: Draft, assignees: Assignee[] | null, opId: string): Promise<TaskCard> => {
      const open = me.statuses.find((s) => s.category === "open") ?? me.statuses[0]!;
      const who = assignees?.find((a) => a.userId === draft.assigneeId);
      const tempId = `new-${opId}`;
      const temp: TaskListItem = {
        id: tempId,
        number: 0,
        branchId: draft.branchId,
        title: draft.title.trim(),
        status: open,
        assignee: {
          id: draft.assigneeId,
          displayName: who?.displayName ?? me.user.displayName,
          self: draft.assigneeId === me.user.id,
        },
        branchName: me.branches.find((b) => b.id === draft.branchId)?.name ?? null,
        dueDate: draft.dueDate || null,
        dueAt: null,
        overdue: false,
        isPersonal: draft.assigneeId === me.user.id,
        cancelled: false,
        checklist: { total: 0, done: 0 },
        version: 0,
        moves: [],
        primary: null,
      };
      if (listQuery) prependItem(listQuery, temp);
      try {
        const card = await api<TaskCard>("POST", "/api/tasks", {
          opId,
          branchId: draft.branchId || null,
          title: draft.title.trim(),
          assigneeId: draft.assigneeId,
          dueDate: draft.dueDate || null,
          dueTime: draft.dueDate && draft.dueTime ? draft.dueTime : null,
          description: draft.description.trim() || null,
          resultCriteria: draft.resultCriteria.trim() || null,
          requiresResult: draft.requiresResult,
          requiresAttachment: draft.requiresAttachment,
        });
        if (listQuery) {
          const item = itemFromCard(card);
          item.assignee.self = item.assignee.id === me.user.id;
          linkKey(card.task.id, tempId);
          replaceItem(listQuery, tempId, item);
        }
        invalidateLists();
        return card;
      } catch (e) {
        if (listQuery) replaceItem(listQuery, tempId, null);
        throw e;
      }
    },
    [listQuery, me],
  );
}

function BranchPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { me } = useCabinet();
  const [open, setOpen] = React.useState(false);
  if (me.branches.length <= 1 || !me.capabilities.switchBranch) return null;
  const name = me.branches.find((b) => b.id === value)?.name ?? t("tasks.form.choose");
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <PickerChip aria-label={`${t("tasks.form.branch")}: ${name}`}>
          <Building2 className="size-3.5" />
          <span className="max-w-32 truncate">{name}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </PickerChip>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="card-in z-50 w-64 rounded-2xl border border-border bg-surface p-1.5 shadow-[0_18px_50px_-20px_#1d243366]"
        >
          {me.branches.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onChange(b.id);
                setOpen(false);
              }}
              className={cn(
                "block w-full cursor-pointer truncate rounded-xl px-3 py-2 text-left text-sm font-semibold",
                b.id === value ? "bg-selected/70 text-selected-foreground" : "hover:bg-muted",
              )}
            >
              {b.name}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Быстрое добавление над списком: название + Enter. Исполнитель и срок — одним нажатием. */
export function QuickAdd({ listQuery, inputRef }: { listQuery: string | null; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const { me } = useCabinet();
  const toast = useToast();
  const { draft, set, setDraft, initial, assignees } = useDraft();
  const [expanded, setExpanded] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const create = useCreate(listQuery);
  const opId = React.useRef(newOpId());
  const localRef = React.useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const active = focused || Boolean(draft.title);

  const submit = async () => {
    if (!draft.title.trim()) return;
    const snapshot = draft;
    const id = opId.current;
    // Поле очищается сразу — можно вводить следующую задачу.
    setDraft({
      ...initial(),
      branchId: draft.branchId,
      assigneeId: draft.assigneeId,
    });
    opId.current = newOpId();
    try {
      await create(snapshot, assignees, id);
    } catch (e) {
      setDraft(snapshot);
      toast(errorText(e instanceof ApiError ? e.code : "network"), "danger");
    }
  };

  return (
    <>
      <Card
        className={cn(
          "rise-in overflow-hidden p-1.5 transition-shadow",
          active && "shadow-[0_0_0_3px_color-mix(in_oklab,var(--am-accent)_16%,transparent),0_10px_30px_-20px_#1d243333]",
        )}
        style={{ "--i": 4 } as React.CSSProperties}
      >
        <form
          className="flex flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <span
            aria-hidden
            className={cn(
              "ml-1 grid size-8 shrink-0 place-items-center rounded-lg transition-colors",
              active ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
            )}
          >
            <Plus className="size-4" />
          </span>
          <input
            ref={ref}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            maxLength={300}
            placeholder={t("tasks.quick.placeholder")}
            aria-label={t("tasks.quick.placeholder")}
            className="h-10 min-w-0 flex-1 basis-56 bg-transparent px-1.5 text-[15px] font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground focus-visible:outline-none"
          />
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <BranchPicker value={draft.branchId} onChange={(branchId) => set({ branchId })} />
            {me.capabilities.assignOthers ? (
              <AssigneePicker assignees={assignees} value={draft.assigneeId} onChange={(assigneeId) => set({ assigneeId })} />
            ) : null}
            <DuePicker date={draft.dueDate} time={draft.dueTime} onChange={(dueDate, dueTime) => set({ dueDate, dueTime })} />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-foreground/55 transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t("tasks.quick.more")}
              title={t("tasks.quick.more")}
            >
              <Maximize2 className="size-4" />
            </button>
            <Button type="submit" size="sm" disabled={!draft.title.trim()} className={cn("transition-all", draft.title.trim() ? "opacity-100" : "opacity-60")}>
              {t("tasks.quick.add")}
              <CornerDownLeft className="opacity-70" />
            </Button>
          </div>
        </form>
      </Card>
      <CreateTaskDialog
        open={expanded}
        onOpenChange={setExpanded}
        listQuery={listQuery}
        start={draft}
        onCreated={() =>
          setDraft({
            ...initial(),
            branchId: draft.branchId,
            assigneeId: draft.assigneeId,
          })
        }
      />
    </>
  );
}

/** Полная форма: те же поля плюс описание и требования к результату (скрыты, пока не нужны). */
export function CreateTaskDialog({
  open,
  onOpenChange,
  listQuery,
  start,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listQuery: string | null;
  start?: Partial<Draft>;
  onCreated?: (card: TaskCard) => void;
}) {
  const { me } = useCabinet();
  const toast = useToast();
  const { draft, set, setDraft, initial, assignees } = useDraft();
  const [details, setDetails] = React.useState(false);
  const create = useCreate(listQuery);
  const opId = React.useRef(newOpId());
  const shortcut = useSubmitShortcutLabel();

  React.useEffect(() => {
    if (!open) return;
    setDraft({ ...initial(), ...start });
    setDetails(Boolean(start?.description || start?.resultCriteria));
    opId.current = newOpId();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { run, pending, error, fieldErrors } = useSubmit(async () => {
    const card = await create(draft, assignees, opId.current);
    onOpenChange(false);
    onCreated?.(card);
    toast(t("tasks.quick.created", { title: card.task.title }));
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
            <Button type="submit" form={formId} disabled={pending || !draft.branchId || !draft.title.trim()}>
              {pending ? <Spinner /> : null}
              {t("tasks.form.create")}
              <Kbd>{shortcut}</Kbd>
            </Button>
          </>
        }
      >
        <form
          id={formId}
          className="grid gap-4"
          onKeyDown={onSubmitShortcut}
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label={t("tasks.form.title")} error={fieldErrors.title}>
            <Input
              value={draft.title}
              onChange={(e) => set({ title: e.target.value })}
              required
              maxLength={300}
              autoFocus
              className="h-12 text-[17px] font-bold"
              placeholder={t("tasks.quick.placeholder")}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            <BranchPicker value={draft.branchId} onChange={(branchId) => set({ branchId })} />
            {me.capabilities.assignOthers ? (
              <AssigneePicker assignees={assignees} value={draft.assigneeId} onChange={(assigneeId) => set({ assigneeId })} />
            ) : null}
            <DuePicker date={draft.dueDate} time={draft.dueTime} onChange={(dueDate, dueTime) => set({ dueDate, dueTime })} />
          </div>
          {fieldErrors.assigneeId || fieldErrors.dueDate || fieldErrors.branchId ? (
            <p className="text-xs font-semibold text-danger">{fieldErrors.assigneeId ?? fieldErrors.dueDate ?? fieldErrors.branchId}</p>
          ) : null}

          <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", details ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
            <div className="min-h-0 overflow-hidden">
              <div className="grid gap-4 pb-1">
                <Field label={t("tasks.form.description")} error={fieldErrors.description}>
                  <Textarea
                    value={draft.description}
                    onChange={(e) => set({ description: e.target.value })}
                    rows={3}
                    maxLength={10000}
                    placeholder={t("tasks.quick.descriptionPlaceholder")}
                  />
                </Field>
                <Field label={t("tasks.form.resultCriteria")} error={fieldErrors.resultCriteria}>
                  <Textarea
                    value={draft.resultCriteria}
                    onChange={(e) => set({ resultCriteria: e.target.value })}
                    rows={2}
                    maxLength={5000}
                    placeholder={t("tasks.form.resultCriteriaHint")}
                  />
                </Field>
                <div className="grid gap-3 rounded-xl bg-muted/60 p-3">
                  <Switch
                    checked={draft.requiresResult}
                    onChange={(v) => set({ requiresResult: v })}
                    label={t("tasks.form.requiresResult")}
                    hint={t("tasks.quick.requiresResultHint")}
                  />
                  <Switch
                    checked={draft.requiresAttachment}
                    onChange={(v) => set({ requiresAttachment: v })}
                    label={t("tasks.form.requiresAttachment")}
                    hint={t("tasks.quick.requiresAttachmentHint")}
                  />
                </div>
              </div>
            </div>
          </div>
          {!details ? (
            <button
              type="button"
              onClick={() => setDetails(true)}
              className="flex w-fit cursor-pointer items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              <Plus className="size-4" />
              {t("tasks.quick.addDetails")}
            </button>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
