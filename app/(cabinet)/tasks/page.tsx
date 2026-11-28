"use client";

import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  Columns3,
  Download,
  Eye,
  List,
  ListTodo,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  SearchX,
  Send,
  SlidersHorizontal,
  X,
} from "lucide-react";
import Link from "next/link";
import { useOpenTask } from "@/components/tasks/task-panel";
import { DropdownMenu, Popover } from "radix-ui";
import * as React from "react";
import { BranchDialog } from "@/components/cabinet/branch-dialog";
import { ALL, useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState, PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { QuickAdd, useAssignees } from "@/components/tasks/create-task-dialog";
import { DueText, StatusPill, transitionLabel } from "@/components/tasks/labels";
import { AssigneePicker } from "@/components/tasks/pickers";
import { applyCard, loadCard, patchItem, prefetchCard, rowKey, setTaskSaving, taskIsSaving, useTaskList } from "@/components/tasks/store";
import { StatusDialog } from "@/components/tasks/task-dialogs";
import type { TaskCard, TaskList, TaskListItem, TransitionInfo } from "@/components/tasks/types";
import { useTaskAction } from "@/components/tasks/use-task";
import { Avatar } from "@/components/ui/avatar";
import { Button, Chip, Kbd } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { useSlashToFocus } from "@/lib/hotkeys";
import { errorText, t } from "@/lib/i18n";
import { needsTransitionForm } from "@/lib/task-transition";
import { newOpId } from "@/lib/op";
import { cn } from "@/lib/utils";

type Filters = {
  view: "" | "mine" | "all";
  q: string;
  status: string;
  assignee: string;
  due: string;
  layout: "" | "board";
};
const EMPTY: Filters = {
  view: "",
  q: "",
  status: "",
  assignee: "",
  due: "",
  layout: "",
};
const SCROLL_KEY = "am.tasks.scroll";
const CANCELLED = "_cancelled";
const DUE_KEYS = ["overdue", "today", "week", "has", "none"] as const;

function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY;
  const p = new URLSearchParams(window.location.search);
  return {
    view: (p.get("view") as Filters["view"]) || "",
    q: p.get("q") ?? "",
    status: p.get("status") ?? "",
    assignee: p.get("assignee") ?? "",
    due: p.get("due") ?? "",
    layout: p.get("layout") === "board" ? "board" : "",
  };
}

/** Адрес отражает филиал, фильтры и вид: «Назад» из карточки возвращает ту же выдачу. */
function toQuery(f: Filters, branchId: string | null): string {
  const p = new URLSearchParams();
  if (branchId) p.set("branch", branchId);
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
}

/** Запрос к серверу — тот же для списка и доски (вид на выдачу не влияет). */
function apiQuery(f: Filters, branchId: string | null): string {
  const { layout: _layout, ...rest } = f;
  return toQuery({ ...rest, layout: "" }, branchId);
}

function downloadCsv(data: TaskList) {
  const rows = [
    ["№", t("tasks.columns.title"), t("tasks.columns.assignee"), t("tasks.columns.branch"), t("tasks.columns.due"), t("tasks.columns.status")],
    ...data.items.map((i) => [
      String(i.number),
      i.title,
      i.assignee.displayName,
      i.branchName ?? "",
      i.dueAt ? formatShortDateTime(i.dueAt, data.timezone) : t("tasks.due.none"),
      i.cancelled ? data.cancelledName : i.status.name,
    ]),
  ];
  const csv = rows.map((r) => r.map((c) => `"${c.replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `tasks-${data.today}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Смена статуса из списка или доски: строка меняется сразу, сервер подтверждает в фоне.
 * Если нужен результат или комментарий — открывается та же форма, что в карточке.
 */
function useMove() {
  const { me } = useCabinet();
  const toast = useToast();
  const [form, setForm] = React.useState<{
    card: TaskCard;
    transition: TransitionInfo;
  } | null>(null);
  const [flash, setFlash] = React.useState<Record<string, "success" | "danger">>({});
  const act = useTaskAction((c) => {
    applyCard(c, me.user.id);
    setForm((f) => (f ? { ...f, card: c } : f));
  });
  const opIds = React.useRef(new Map<string, string>());

  const mark = (id: string, tone: "success" | "danger") => {
    setFlash((f) => ({ ...f, [id]: tone }));
    window.setTimeout(() => setFlash((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== id))), 1400);
  };

  const move = React.useCallback(
    async (item: TaskListItem, to: string, statuses: TaskList["statuses"]) => {
      if (taskIsSaving(item.id)) return;
      const m = item.moves.find((x) => x.to === to);
      if (!m) {
        toast(t("tasks.board.forbidden"), "danger");
        return;
      }
      if (m.needsForm) {
        try {
          const card = await loadCard(item.id);
          const transition = card.transitions.find((tr) => tr.to === to);
          if (!transition) throw new ApiError("transition_forbidden", 403, null);
          if (needsTransitionForm(transition.requires, card.attachments.length)) {
            setForm({ card, transition });
            return;
          }
        } catch (e) {
          toast(errorText(e instanceof ApiError ? e.code : "network"), "danger");
          return;
        }
      }
      const target = statuses.find((s) => s.key === to);
      const before = { ...item };
      setTaskSaving(item.id, true);
      patchItem(item.id, {
        status: {
          key: to,
          name: m.toName,
          category: target?.category ?? "progress",
        },
        moves: [],
        primary: null,
        overdue: target?.category === "done" ? false : item.overdue,
      });
      const opId = opIds.current.get(item.id) ?? newOpId();
      opIds.current.set(item.id, opId);
      try {
        const card = await api<TaskCard>("POST", `/api/tasks/${item.id}/status`, { to, opId, version: item.version });
        opIds.current.delete(item.id);
        applyCard(card, me.user.id);
        mark(item.id, "success");
        toast(
          t("tasks.moved", {
            title: item.title,
            status: card.task.status.name,
          }),
        );
      } catch (e) {
        opIds.current.delete(item.id);
        const current = e instanceof ApiError ? (e.details as { current?: TaskCard } | null)?.current : null;
        if (current) applyCard(current, me.user.id);
        else patchItem(item.id, before);
        mark(item.id, "danger");
        toast(errorText(e instanceof ApiError ? e.code : "network"), "danger");
      } finally {
        setTaskSaving(item.id, false);
      }
    },
    [me.user.id, toast],
  );

  const dialog = form ? (
    <StatusDialog
      card={form.card}
      transition={form.transition}
      open
      onOpenChange={(o) => !o && setForm(null)}
      act={act}
      setCard={(c) => {
        applyCard(c, me.user.id);
        setForm((f) => (f ? { ...f, card: c } : f));
      }}
      onDone={(c) => {
        setForm(null);
        mark(c.task.id, "success");
        toast(t("tasks.moved", { title: c.task.title, status: c.task.status.name }));
      }}
    />
  ) : null;

  return { move, flash, dialog };
}

export default function TasksPage() {
  const { me, refreshMe, branchId, setBranchId, branchEpoch } = useCabinet();
  const [creatingBranch, setCreatingBranch] = React.useState(false);
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [searchDraft, setSearchDraft] = React.useState("");
  const [ready, setReady] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const addRef = React.useRef<HTMLInputElement>(null);
  useSlashToFocus(searchRef);
  const assignees = useAssignees(branchId, me.capabilities.assignOthers);
  const mover = useMove();

  // Восстановление фильтров и филиала из адреса (возврат из карточки, ссылка).
  React.useEffect(() => {
    const f = readFilters();
    setFilters(f);
    setSearchDraft(f.q);
    const urlBranch = new URLSearchParams(window.location.search).get("branch");
    if (urlBranch && urlBranch !== branchId && (urlBranch === ALL ? me.capabilities.switchBranch : me.branches.some((b) => b.id === urlBranch))) {
      setBranchId(urlBranch);
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const urlQuery = toQuery(filters, branchId);
  const query = ready && branchId ? apiQuery(filters, branchId) : null;
  const { data, exact, error, refreshing, refresh } = useTaskList(query, branchEpoch);

  React.useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(urlQuery);
    const task = new URLSearchParams(window.location.search).get("task");
    if (task) params.set("task", task);
    const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [urlQuery, ready]);

  // Поиск — по мере ввода, с короткой паузой.
  React.useEffect(() => {
    const value = searchDraft.trim();
    if (value === filters.q) return;
    const timer = window.setTimeout(() => setFilters((f) => ({ ...f, q: value })), 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft, filters.q]);

  // При смене филиала фильтр по исполнителю другого филиала сбрасывается.
  const prevBranch = React.useRef(branchId);
  React.useEffect(() => {
    if (prevBranch.current && prevBranch.current !== branchId) setFilters((f) => ({ ...f, assignee: f.assignee === "me" ? "me" : "" }));
    prevBranch.current = branchId;
  }, [branchId]);

  // Прокрутка восстанавливается после возврата из карточки.
  const restored = React.useRef(false);
  React.useEffect(() => {
    if (!data || restored.current) return;
    restored.current = true;
    try {
      const saved = sessionStorage.getItem(SCROLL_KEY);
      if (saved) {
        const { q, y } = JSON.parse(saved) as { q: string; y: number };
        if (q === urlQuery) window.scrollTo(0, y);
        sessionStorage.removeItem(SCROLL_KEY);
      }
    } catch {
      /* хранилище недоступно */
    }
  }, [data, urlQuery]);

  const rememberScroll = React.useCallback(() => {
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ q: urlQuery, y: window.scrollY }));
    } catch {
      /* хранилище недоступно */
    }
  }, [urlQuery]);

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const hasFilters = Boolean(filters.q || filters.status || filters.assignee || filters.due);

  if (me.branches.length === 0) {
    return (
      <>
        <PageHeader title={t("tasks.title")} />
        <PageBody>
          <Card>
            <EmptyState
              icon={<Building2 className="size-6" />}
              title={t("branch.none")}
              text={me.capabilities.manageBranches ? t("branch.createHint") : t("branch.noneHint")}
              action={
                me.capabilities.manageBranches ? (
                  <Button onClick={() => setCreatingBranch(true)}>
                    <Plus />
                    {t("branch.create")}
                  </Button>
                ) : null
              }
            />
          </Card>
          <BranchDialog
            open={creatingBranch}
            onOpenChange={setCreatingBranch}
            onSaved={async (b) => {
              await refreshMe();
              setBranchId(b.id);
            }}
          />
        </PageBody>
      </>
    );
  }

  const view = data?.view ?? (filters.view || "mine");
  const board = filters.layout === "board";
  const statuses = data?.statuses ?? me.statuses;
  const move = (item: TaskListItem, to: string) => void mover.move(item, to, statuses);

  return (
    <>
      <PageHeader title={t("tasks.title")} />
      <PageBody className="flex flex-col gap-3">
        <Overview data={data} statuses={statuses} filters={filters} set={set} />

        <QuickAdd listQuery={query} inputRef={addRef} />

        {/* Поиск, «Мои / Все», фильтры, вид, выгрузка. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex min-w-[200px] flex-1 items-center">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t("tasks.search")}</span>
            <input
              ref={searchRef}
              type="search"
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder={t("tasks.search")}
              className="control-h w-full rounded-lg border border-input bg-surface pl-9 pr-10 text-sm font-medium placeholder:font-normal placeholder:text-muted-foreground"
            />
            <Kbd className="absolute right-2.5 text-muted-foreground">/</Kbd>
          </label>

          {data?.viewsDiffer ? (
            <Segmented
              label={t("tasks.views.label")}
              value={view}
              options={(["mine", "all"] as const).map((v) => ({
                value: v,
                label: t(`tasks.views.${v}`),
              }))}
              onChange={(v) => set({ view: v as Filters["view"] })}
            />
          ) : null}

          <FiltersButton filters={filters} set={set} statuses={statuses} data={data} assignees={me.capabilities.assignOthers ? assignees : null} />

          <Segmented
            label={t("tasks.layout.label")}
            value={filters.layout}
            options={[
              { value: "", label: t("tasks.layout.list"), icon: List },
              {
                value: "board",
                label: t("tasks.layout.board"),
                icon: Columns3,
              },
            ]}
            onChange={(v) => set({ layout: v as Filters["layout"] })}
            iconOnly
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("tasks.csv")}
            title={t("tasks.csv")}
            disabled={!data?.items.length}
            onClick={() => data && downloadCsv(data)}
          >
            <Download />
          </Button>
        </div>

        <ActiveFilters
          filters={filters}
          set={set}
          statuses={statuses}
          data={data}
          assignees={assignees}
          onReset={() => {
            setSearchDraft("");
            setFilters((f) => ({ ...EMPTY, view: f.view, layout: f.layout }));
          }}
        />

        {/* Тонкая полоса вместо «Загрузка…»: данные на экране остаются. */}
        <div className="relative -my-1.5 h-0.5 overflow-hidden rounded-full" aria-hidden>
          {refreshing && data ? <div className="progress-bar absolute inset-0 opacity-70" /> : null}
        </div>

        {error && !data ? (
          <LoadError message={error} onRetry={refresh} />
        ) : !data ? (
          <ListSkeleton />
        ) : data.items.length === 0 && !board ? (
          <Card className="page-in">
            {hasFilters ? (
              <EmptyState
                icon={<SearchX className="size-6" />}
                title={t("tasks.noMatches")}
                text={t("tasks.noMatchesText")}
                action={
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearchDraft("");
                      setFilters((f) => ({
                        ...EMPTY,
                        view: f.view,
                        layout: f.layout,
                      }));
                    }}
                  >
                    {t("tasks.resetFilters")}
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<ListTodo className="size-6" />}
                title={t("tasks.emptyTitle")}
                text={view === "mine" && data.viewsDiffer ? t("tasks.emptyMine") : t("tasks.emptyText")}
                action={
                  <Button onClick={() => addRef.current?.focus()}>
                    <Plus />
                    {t("tasks.create")}
                  </Button>
                }
              />
            )}
          </Card>
        ) : (
          <div className={cn("transition-opacity duration-200", !exact && "opacity-70")} aria-busy={refreshing}>
            {board ? (
              <Board data={data} onOpen={rememberScroll} move={move} flash={mover.flash} />
            ) : (
              <TaskTable data={data} onOpen={rememberScroll} move={move} flash={mover.flash} />
            )}
            <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
              {data.hasMore ? t("tasks.more", { n: data.items.length }) : t("tasks.found", { n: data.items.length })}
            </p>
          </div>
        )}
        {mover.dialog}
      </PageBody>
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-2" aria-busy="true" aria-label={t("app.loading")}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="h-[58px] rounded-xl" />
      ))}
    </div>
  );
}

function Segmented({
  label,
  value,
  options,
  onChange,
  iconOnly,
}: {
  label: string;
  value: string;
  options: {
    value: string;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
  }[];
  onChange: (v: string) => void;
  iconOnly?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-border bg-surface p-0.5">
      {options.map(({ value: v, label: l, icon: Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={iconOnly ? l : undefined}
          title={iconOnly ? l : undefined}
          onClick={() => onChange(v)}
          className={cn(
            "flex h-8 cursor-pointer items-center justify-center rounded-md text-[13px] font-semibold transition-all active:scale-95",
            iconOnly ? "w-8" : "px-3",
            value === v ? "bg-selected text-selected-foreground" : "text-foreground/65 hover:bg-muted",
          )}
        >
          {Icon ? <Icon className="size-[18px]" /> : l}
        </button>
      ))}
    </div>
  );
}

function dueName(key: string) {
  return t(`tasks.filters.${key}`);
}

/** Все фильтры в одном окне — на экране остаётся только то, что выбрано. */
function FiltersButton({
  filters,
  set,
  statuses,
  data,
  assignees,
}: {
  filters: Filters;
  set: (p: Partial<Filters>) => void;
  statuses: TaskList["statuses"];
  data: TaskList | null;
  assignees: ReturnType<typeof useAssignees>;
}) {
  const { me } = useCabinet();
  const active = [filters.status, filters.due, filters.assignee].filter(Boolean).length;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="outline" className={cn(active && "border-primary/40 bg-selected/40")}>
          <SlidersHorizontal />
          {t("tasks.filtersButton")}
          {active ? (
            <span className="pop grid size-5 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{active}</span>
          ) : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="card-in z-50 grid w-[340px] max-w-[calc(100vw-24px)] gap-4 rounded-2xl border border-border bg-surface p-4 shadow-[0_18px_50px_-20px_#1d243366]"
        >
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tasks.statusLabel")}</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip selected={!filters.status} onClick={() => set({ status: "" })}>
                {t("tasks.anyStatus")}
              </Chip>
              {statuses.map((s) => (
                <Chip
                  key={s.key}
                  selected={filters.status === s.key}
                  count={data?.counts.byStatus[s.key]}
                  onClick={() => set({ status: filters.status === s.key ? "" : s.key })}
                >
                  {s.name}
                </Chip>
              ))}
              <Chip
                selected={filters.status === CANCELLED}
                count={data?.counts.cancelled}
                onClick={() => set({ status: filters.status === CANCELLED ? "" : CANCELLED })}
              >
                {data?.cancelledName ?? me.cancelledName}
              </Chip>
            </div>
          </div>
          <div className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tasks.filters.due")}</p>
            <div className="flex flex-wrap gap-1.5">
              <Chip selected={!filters.due} onClick={() => set({ due: "" })}>
                {t("tasks.filters.dueAll")}
              </Chip>
              {DUE_KEYS.map((k) => (
                <Chip key={k} selected={filters.due === k} onClick={() => set({ due: filters.due === k ? "" : k })}>
                  {dueName(k)}
                </Chip>
              ))}
            </div>
          </div>
          {assignees ? (
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("tasks.filters.assignee")}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip selected={!filters.assignee} onClick={() => set({ assignee: "" })}>
                  {t("tasks.filters.assigneeAll")}
                </Chip>
                <AssigneePicker
                  assignees={assignees}
                  value={filters.assignee === "me" ? me.user.id : filters.assignee}
                  fallbackName={t("tasks.filters.assigneeChoose")}
                  onChange={(id) => set({ assignee: id === me.user.id ? "me" : id })}
                />
              </div>
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Выбранные фильтры — снимаются одним нажатием. */
function ActiveFilters({
  filters,
  set,
  statuses,
  data,
  assignees,
  onReset,
}: {
  filters: Filters;
  set: (p: Partial<Filters>) => void;
  statuses: TaskList["statuses"];
  data: TaskList | null;
  assignees: ReturnType<typeof useAssignees>;
  onReset: () => void;
}) {
  const { me } = useCabinet();
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.status) {
    const name =
      filters.status === CANCELLED ? (data?.cancelledName ?? me.cancelledName) : (statuses.find((s) => s.key === filters.status)?.name ?? filters.status);
    chips.push({
      key: "status",
      label: name,
      clear: () => set({ status: "" }),
    });
  }
  if (filters.due)
    chips.push({
      key: "due",
      label: dueName(filters.due),
      clear: () => set({ due: "" }),
    });
  if (filters.assignee) {
    const name = filters.assignee === "me" ? t("tasks.quick.me") : (assignees?.find((a) => a.userId === filters.assignee)?.displayName ?? "…");
    chips.push({
      key: "assignee",
      label: name,
      clear: () => set({ assignee: "" }),
    });
  }
  if (filters.q) chips.push({ key: "q", label: `«${filters.q}»`, clear: onReset });
  if (chips.length === 0) return null;
  return (
    <div className="page-in flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.clear}
          className="pop inline-flex h-7 cursor-pointer items-center gap-1 rounded-full bg-selected pl-3 pr-2 text-[13px] font-semibold text-selected-foreground transition-colors hover:bg-selected/70"
        >
          {c.label}
          <X className="size-3.5" />
        </button>
      ))}
      {chips.length > 1 ? (
        <button type="button" onClick={onReset} className="cursor-pointer px-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground">
          {t("tasks.filtersReset")}
        </button>
      ) : null}
    </div>
  );
}

/** Сводка над списком: сколько в работе, просрочено, ждёт проверки, сделано. Нажатие — фильтр. */
function Overview({
  data,
  statuses,
  filters,
  set,
}: {
  data: TaskList | null;
  statuses: { key: string; category: string }[];
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
}) {
  const sum = (cats: string[]) => statuses.filter((s) => cats.includes(s.category)).reduce((n, s) => n + (data?.counts.byStatus[s.key] ?? 0), 0);
  const first = (cat: string) => statuses.find((s) => s.category === cat)?.key ?? "";
  const review = first("review");
  const loading = !data;
  return (
    <div className={cn("grid grid-cols-2 gap-3", review ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      <StatTile
        index={0}
        icon={Clock3}
        label={t("tasks.overview.work")}
        value={sum(["open", "progress"])}
        hint={t("tasks.overview.workHint")}
        loading={loading}
        onClick={() => set({ status: "", due: "" })}
      />
      <StatTile
        index={1}
        icon={AlertTriangle}
        tone="danger"
        label={t("tasks.overview.overdue")}
        value={data?.counts.overdue ?? 0}
        hint={t("tasks.overview.overdueHint")}
        loading={loading}
        active={filters.due === "overdue"}
        onClick={() => set({ due: filters.due === "overdue" ? "" : "overdue", status: "" })}
      />
      {review ? (
        <StatTile
          index={2}
          icon={Eye}
          tone="warning"
          label={t("tasks.overview.review")}
          value={sum(["review"])}
          hint={t("tasks.overview.reviewHint")}
          loading={loading}
          active={filters.status === review}
          onClick={() => set({ status: filters.status === review ? "" : review, due: "" })}
        />
      ) : null}
      <StatTile
        index={3}
        icon={CheckCircle2}
        tone="success"
        label={t("tasks.overview.done")}
        value={sum(["done"])}
        hint={t("tasks.overview.doneHint")}
        loading={loading}
        active={filters.status === first("done")}
        onClick={() =>
          set({
            status: filters.status === first("done") ? "" : first("done"),
            due: "",
          })
        }
      />
    </div>
  );
}

const MOVE_ICON = { progress: Play, review: Send, done: Check } as const;

/**
 * Круглая кнопка слева в строке — основное действие одним нажатием («Начать», «Сдать», «Принять»).
 * Без действия — показывает состояние: выполнено, на проверке, ждёт.
 */
function QuickAction({ item, statuses, move }: { item: TaskListItem; statuses: TaskList["statuses"]; move: (item: TaskListItem, to: string) => void }) {
  const m = item.primary ? item.moves.find((x) => x.to === item.primary) : undefined;
  const cat = item.cancelled ? "cancelled" : item.status.category;
  // Выполненную задачу кнопка не «переоткрывает» случайно — это делается в карточке.
  if (!m || item.saving || item.id.startsWith("new-") || cat === "done") {
    return (
      <span
        key={cat}
        aria-hidden
        className={cn(
          "pop grid size-8 shrink-0 place-items-center rounded-full border-2",
          cat === "done"
            ? "burst border-success bg-success text-white"
            : cat === "review"
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border text-transparent",
        )}
      >
        {cat === "done" ? <Check className="size-4" strokeWidth={3} /> : cat === "review" ? <Eye className="size-3.5" /> : null}
      </span>
    );
  }
  const targetCat = (statuses.find((s) => s.key === m.to)?.category ?? "progress") as keyof typeof MOVE_ICON;
  const Icon = MOVE_ICON[targetCat] ?? Play;
  const label = transitionLabel(
    {
      to: m.to,
      toName: m.toName,
      kind: m.kind,
      requires: {
        comment: false,
        result: false,
        resultText: false,
        attachment: false,
      },
    },
    item.status.category,
  );
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        move(item, m.to);
      }}
      title={label}
      aria-label={`${label}: ${item.title}`}
      className={cn(
        "group/qa relative z-10 grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-2 transition-all duration-200 hover:scale-110 active:scale-90",
        targetCat === "done"
          ? "border-success/50 text-success hover:bg-success hover:text-white"
          : "border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground",
      )}
    >
      <Icon className={cn("size-3.5 transition-transform group-hover/qa:scale-110", targetCat === "progress" && "translate-x-px")} strokeWidth={2.5} />
    </button>
  );
}

function AssigneeCell({ item, allBranches }: { item: TaskListItem; allBranches: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Avatar name={item.assignee.displayName} size={28} />
      <span className="min-w-0">
        <span className="block truncate" title={item.assignee.displayName}>
          {item.assignee.self ? t("tasks.quick.me") : item.assignee.displayName}
        </span>
        {allBranches && item.branchName ? <span className="block truncate text-xs text-muted-foreground">{item.branchName}</span> : null}
      </span>
    </span>
  );
}

function ChecklistBadge({ item }: { item: TaskListItem }) {
  if (!item.checklist.total) return null;
  const pct = Math.round((item.checklist.done / item.checklist.total) * 100);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground" title={`${item.checklist.done}/${item.checklist.total}`}>
      <span className="relative h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <span className="absolute inset-y-0 left-0 rounded-full bg-success transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </span>
      {item.checklist.done}/{item.checklist.total}
    </span>
  );
}

/** Список: строка — ссылка на карточку; круглая кнопка — основное действие; при наведении карточка подгружается заранее. */
function TaskTable({
  data,
  onOpen,
  move,
  flash,
}: {
  data: TaskList;
  onOpen: () => void;
  move: (item: TaskListItem, to: string) => void;
  flash: Record<string, "success" | "danger">;
}) {
  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {data.items.map((task, i) => {
          const pending = task.id.startsWith("new-") || Boolean(task.saving);
          const href = pending ? undefined : `/tasks/${task.id}`;
          return (
            <li
              key={rowKey(task.id)}
              className={cn(task.id.startsWith("new-") && "slide-in", flash[task.id] && "flash")}
              style={
                {
                  "--i": Math.min(i, 8),
                  "--flash": flash[task.id] === "danger" ? "var(--am-danger)" : undefined,
                } as React.CSSProperties
              }
            >
              <div
                className={cn(
                  "group relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50 sm:px-4",
                  task.cancelled && "opacity-60",
                  pending && "task-saving opacity-70",
                )}
              >
                <QuickAction item={task} statuses={data.statuses} move={move} />
                {href ? (
                  <Link
                    href={href}
                    prefetch={false}
                    onClick={onOpen}
                    onMouseEnter={() => prefetchCard(task.id)}
                    onFocus={() => prefetchCard(task.id)}
                    onTouchStart={() => prefetchCard(task.id)}
                    className="min-w-0 flex-1 outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    <RowBody task={task} data={data} />
                  </Link>
                ) : (
                  <div className="min-w-0 flex-1">
                    <RowBody task={task} data={data} />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RowBody({ task, data }: { task: TaskListItem; data: TaskList }) {
  return (
    <span className="grid min-w-0 items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_200px_170px_130px]">
      <span className="min-w-0">
        <span
          className={cn("block font-bold break-anywhere transition-colors group-hover:text-primary", task.status.category === "done" && "text-foreground/60")}
        >
          {task.title}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
          {task.number ? <span>#{task.number}</span> : null}
          <ChecklistBadge item={task} />
          <span className="md:hidden">
            <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={data.timezone} className="text-xs" />
          </span>
          <span className="truncate md:hidden">· {task.assignee.self ? t("tasks.quick.me") : task.assignee.displayName}</span>
        </span>
      </span>
      <span className="hidden text-sm md:block">
        <AssigneeCell item={task} allBranches={data.allBranches} />
      </span>
      <span className="hidden md:block">
        <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={data.timezone} />
      </span>
      <span className="hidden justify-self-start md:block">
        <StatusPill
          key={task.cancelled ? "c" : task.status.key}
          status={task.status}
          cancelledName={task.cancelled ? data.cancelledName : null}
          className="pop"
        />
      </span>
    </span>
  );
}

/**
 * Доска: колонки по статусам из той же выдачи, что и список. Перетаскивание мышью или меню «…»;
 * карточка переезжает сразу, сервер подтверждает в фоне.
 */
function Board({
  data,
  onOpen,
  move,
  flash,
}: {
  data: TaskList;
  onOpen: () => void;
  move: (item: TaskListItem, to: string) => void;
  flash: Record<string, "success" | "danger">;
}) {
  const items = data.items.filter((i) => !i.cancelled);
  const [dragging, setDragging] = React.useState<TaskListItem | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const allowed = (task: TaskListItem | null, key: string) => Boolean(task?.moves.some((m) => m.to === key));

  return (
    <div className="-mx-4 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6">
      <div
        className="grid min-w-[880px] items-start gap-3"
        style={{
          gridTemplateColumns: `repeat(${data.statuses.length}, minmax(220px, 1fr))`,
        }}
      >
        {data.statuses.map((s) => {
          const col = items.filter((i) => i.status.key === s.key);
          const canDrop = dragging ? allowed(dragging, s.key) : false;
          const isSource = dragging?.status.key === s.key;
          return (
            <section
              key={s.key}
              aria-label={s.name}
              onDragOver={(e) => {
                if (!dragging || !canDrop) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== s.key) setOver(s.key);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === s.key ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const task = dragging;
                setDragging(null);
                setOver(null);
                if (task && task.status.key !== s.key) move(task, s.key);
              }}
              className={cn(
                "min-w-0 rounded-xl border border-border bg-muted/70 p-2.5 transition-[background-color,opacity,box-shadow,transform] duration-200",
                dragging && canDrop && "bg-selected/70 task-drop-target",
                dragging && !canDrop && !isSource && "opacity-45",
                over === s.key && canDrop && "task-drop-over",
              )}
            >
              <h2 className="flex items-center gap-2 px-1.5 pb-2.5 pt-1 text-[15px] font-bold">
                {s.name}
                <span key={col.length} className="pop font-semibold text-muted-foreground">
                  {col.length}
                </span>
                {dragging && canDrop && !isSource ? <span className="ml-auto text-xs font-semibold text-primary">{t("tasks.board.dropHere")}</span> : null}
              </h2>
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
                {col.map((task) => (
                  <li key={rowKey(task.id)} className={cn("rounded-xl", flash[task.id] && "flash")}>
                    <BoardCard
                      task={task}
                      data={data}
                      onOpen={onOpen}
                      move={move}
                      dragging={dragging?.id === task.id}
                      onDragStart={() => setDragging(task)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  </li>
                ))}
                {over === s.key && dragging && dragging.status.key !== s.key ? (
                  <li aria-hidden className="h-16 rounded-xl border-2 border-dashed border-primary/60 bg-surface/60" />
                ) : null}
              </ul>
              {col.length === 0 && over !== s.key ? <p className="py-6 text-center text-sm text-muted-foreground">{t("tasks.board.empty")}</p> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({
  task,
  data,
  onOpen,
  move,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  task: TaskListItem;
  data: TaskList;
  onOpen: () => void;
  move: (item: TaskListItem, to: string) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const openTask = useOpenTask();
  const pending = task.id.startsWith("new-") || Boolean(task.saving);
  return (
    <div
      draggable={task.moves.length > 0 && !pending}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onMouseEnter={() => !pending && prefetchCard(task.id)}
      className={cn(
        "relative rounded-xl border border-border bg-surface p-3.5 shadow-[0_1px_2px_rgba(16,24,40,0.06)] transition-[background-color,box-shadow,opacity] duration-150 hover:shadow-md",
        task.moves.length > 0 && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40 shadow-[inset_0_0_0_2px_var(--am-accent)]",
        pending && "task-saving opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        {pending ? (
          <span className="min-w-0 flex-1 font-bold leading-snug break-anywhere">{task.title}</span>
        ) : (
          <Link
            href={`/tasks/${task.id}`}
            prefetch={false}
            onClick={onOpen}
            draggable={false}
            className="min-w-0 flex-1 font-bold leading-snug break-anywhere after:absolute after:inset-0"
          >
            {task.title}
          </Link>
        )}
        {!pending ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              className="relative z-10 -mr-1.5 -mt-1 cursor-pointer rounded-lg p-1 text-foreground/60 hover:bg-muted"
              aria-label={`${t("tasks.board.menu")}: ${task.title}`}
            >
              <MoreHorizontal className="size-5" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="card-in z-50 min-w-52 rounded-xl border border-border bg-surface p-1 shadow-xl">
                <DropdownMenu.Item
                  onSelect={() => {
                    onOpen();
                    openTask(task.id);
                  }}
                  className="cursor-pointer rounded-lg px-2.5 py-2 text-sm font-semibold outline-none data-[highlighted]:bg-muted"
                >
                  {t("tasks.board.open")}
                </DropdownMenu.Item>
                {task.moves.map((m) => (
                  <DropdownMenu.Item
                    key={m.to}
                    onSelect={() => move(task, m.to)}
                    className="cursor-pointer rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                  >
                    {transitionLabel(
                      {
                        to: m.to,
                        toName: m.toName,
                        kind: m.kind,
                        requires: {
                          comment: false,
                          result: false,
                          resultText: false,
                          attachment: false,
                        },
                      },
                      task.status.category,
                    )}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm text-foreground/75">
        <span className="flex min-w-0 items-center gap-1.5">
          <Avatar name={task.assignee.displayName} size={22} />
          <span className="min-w-0 truncate">{task.assignee.self ? t("tasks.quick.me") : task.assignee.displayName}</span>
        </span>
        {task.number ? <span className="shrink-0 text-xs text-muted-foreground">#{task.number}</span> : null}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
        <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={data.timezone} className="text-[13px]" />
        <ChecklistBadge item={task} />
      </div>
    </div>
  );
}
