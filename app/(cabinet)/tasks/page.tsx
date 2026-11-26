"use client";

import { Building2, Columns3, Download, List, ListTodo, MoreHorizontal, Plus, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DropdownMenu } from "radix-ui";
import * as React from "react";
import { BranchDialog } from "@/components/cabinet/branch-dialog";
import { ALL, useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState, PageBody, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { assigneeLabel, CreateTaskDialog, useAssignees } from "@/components/tasks/create-task-dialog";
import { DueText, StatusPill, transitionLabel } from "@/components/tasks/labels";
import { StatusDialog } from "@/components/tasks/task-dialogs";
import type { TaskCard, TaskList, TaskListItem, TransitionInfo } from "@/components/tasks/types";
import { useTaskAction } from "@/components/tasks/use-task";
import { Button, Kbd } from "@/components/ui/button";
import { Card, Spinner } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { formatShortDateTime } from "@/lib/format";
import { useSlashToFocus } from "@/lib/hotkeys";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Filters = { view: "" | "mine" | "all"; q: string; status: string; assignee: string; due: string; layout: "" | "board" };
const EMPTY: Filters = { view: "", q: "", status: "", assignee: "", due: "", layout: "" };
const SCROLL_KEY = "am.tasks.scroll";
const CANCELLED = "_cancelled";

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

/** Запрос к серверу — тот же для списка и канбана (вид на выдачу не влияет). */
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

export default function TasksPage() {
  const { me, refreshMe, branchId, setBranchId, branchEpoch } = useCabinet();
  const router = useRouter();
  const [creatingBranch, setCreatingBranch] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [searchDraft, setSearchDraft] = React.useState("");
  const [data, setData] = React.useState<TaskList | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [ready, setReady] = React.useState(false);
  const searchRef = React.useRef<HTMLInputElement>(null);
  useSlashToFocus(searchRef);
  const assignees = useAssignees(branchId, me.capabilities.assignOthers);

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
  const query = apiQuery(filters, branchId);

  React.useEffect(() => {
    if (!ready) return;
    const next = `${window.location.pathname}${urlQuery ? `?${urlQuery}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [urlQuery, ready]);

  // Загрузка: запоздалый ответ по прежнему филиалу или фильтру на экран не попадает.
  const seq = React.useRef(0);
  const load = React.useCallback(() => {
    if (!ready || !branchId) return;
    const id = ++seq.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<TaskList>("GET", `/api/tasks?${query}`, undefined, { signal: ctrl.signal })
      .then((r) => {
        if (id !== seq.current) return;
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        if (id !== seq.current || (e as Error).name === "AbortError") return;
        setError(e instanceof ApiError ? errorText(e.code) : errorText("network"));
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, ready, branchId]);

  React.useEffect(() => load(), [load, branchEpoch]);

  // При смене филиала фильтр по исполнителю другого филиала сбрасывается.
  const prevBranch = React.useRef(branchId);
  React.useEffect(() => {
    if (prevBranch.current && prevBranch.current !== branchId) setFilters((f) => ({ ...f, assignee: f.assignee === "me" ? "me" : "" }));
    prevBranch.current = branchId;
  }, [branchId]);

  // Прокрутка восстанавливается после загрузки выдачи.
  React.useEffect(() => {
    if (!data) return;
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

  return (
    <>
      <PageHeader title={t("tasks.title")} />
      <PageBody className="flex flex-col gap-3">
        {/* Поиск, вид, «Мои / Все», создание. */}
        <div className="flex flex-wrap items-center gap-2">
          <form
            role="search"
            className="relative flex min-w-[220px] flex-1 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              set({ q: searchDraft.trim() });
            }}
          >
            <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={searchDraft}
              onChange={(e) => {
                setSearchDraft(e.target.value);
                if (!e.target.value) set({ q: "" });
              }}
              onBlur={() => searchDraft.trim() !== filters.q && set({ q: searchDraft.trim() })}
              placeholder={t("tasks.search")}
              aria-label={t("tasks.search")}
              className="h-10 w-full rounded-lg border border-input bg-surface pl-9 pr-10 text-[15px] placeholder:text-muted-foreground/80"
            />
            <Kbd className="absolute right-2.5 text-muted-foreground">/</Kbd>
          </form>

          <div role="group" aria-label={t("tasks.layout.label")} className="flex rounded-lg border border-border bg-surface p-0.5">
            {(
              [
                ["", List, t("tasks.layout.list")],
                ["board", Columns3, t("tasks.layout.board")],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={filters.layout === value}
                aria-label={label}
                title={label}
                onClick={() => set({ layout: value })}
                className={cn("flex size-9 items-center justify-center rounded-md", filters.layout === value ? "bg-selected text-primary" : "text-foreground/70 hover:bg-muted")}
              >
                <Icon className="size-[18px]" />
              </button>
            ))}
          </div>

          {data?.viewsDiffer ? (
            <div role="group" aria-label={t("tasks.views.label")} className="flex rounded-lg border border-border bg-surface p-0.5">
              {(["mine", "all"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => set({ view: v })}
                  className={cn("h-9 rounded-md px-3.5 text-[15px] font-semibold", view === v ? "bg-selected text-foreground" : "text-foreground/70 hover:bg-muted")}
                >
                  {t(`tasks.views.${v}`)}
                </button>
              ))}
            </div>
          ) : null}

          <Button onClick={() => setCreating(true)} className="h-10">
            <Plus />
            {t("tasks.create")}
          </Button>
        </div>

        {/* Статусы со счётчиками, срок, исполнитель, найдено, выгрузка. */}
        <div className="flex flex-wrap items-center gap-2">
          {statuses.map((s) => (
            <StatusChip
              key={s.key}
              label={s.name}
              count={data?.counts.byStatus[s.key]}
              active={filters.status === s.key}
              onClick={() => set({ status: filters.status === s.key ? "" : s.key })}
            />
          ))}
          <StatusChip
            label={data?.cancelledName ?? me.cancelledName}
            count={data?.counts.cancelled}
            active={filters.status === CANCELLED}
            onClick={() => set({ status: filters.status === CANCELLED ? "" : CANCELLED })}
          />
          <NativeSelect aria-label={t("tasks.filters.due")} value={filters.due} onChange={(e) => set({ due: e.target.value })} className="w-40 shrink-0">
            <option value="">{t("tasks.filters.dueAll")}</option>
            <option value="overdue">{t("tasks.filters.overdue")}</option>
            <option value="today">{t("tasks.filters.today")}</option>
            <option value="week">{t("tasks.filters.week")}</option>
            <option value="has">{t("tasks.filters.has")}</option>
            <option value="none">{t("tasks.filters.none")}</option>
          </NativeSelect>
          {me.capabilities.assignOthers ? (
            <NativeSelect
              aria-label={t("tasks.filters.assignee")}
              value={filters.assignee}
              onChange={(e) => set({ assignee: e.target.value })}
              className="w-48 shrink-0"
            >
              <option value="">{t("tasks.filters.assigneeAll")}</option>
              {(assignees ?? []).map((a) => (
                <option key={a.userId} value={a.self ? "me" : a.userId}>
                  {assigneeLabel(a)}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {data ? (
              <span className="text-sm text-muted-foreground" aria-live="polite">
                {t("tasks.found", { n: data.items.length })}
              </span>
            ) : null}
            <Button variant="ghost" size="sm" disabled={!data?.items.length} onClick={() => data && downloadCsv(data)}>
              <Download />
              CSV
            </Button>
          </div>
        </div>

        {error ? (
          <LoadError message={error} onRetry={load} />
        ) : !data ? (
          <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Spinner /> {t("app.loading")}
          </p>
        ) : data.items.length === 0 && !board ? (
          <Card>
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
                      setFilters((f) => ({ ...EMPTY, view: f.view, layout: f.layout }));
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
              />
            )}
          </Card>
        ) : (
          <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
            {board ? (
              <Board data={data} onOpen={rememberScroll} onChanged={load} />
            ) : (
              <TaskTable data={data} onOpen={rememberScroll} />
            )}
            {data.hasMore ? <p className="mt-3 text-sm text-muted-foreground">{t("tasks.more", { n: data.items.length })}</p> : null}
          </div>
        )}

        <CreateTaskDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={(card) => {
            load();
            router.push(`/tasks/${card.task.id}`);
          }}
        />
      </PageBody>
    </>
  );
}

function StatusChip({ label, count, active, onClick }: { label: string; count?: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold",
        active ? "border-primary bg-selected text-foreground" : "border-border bg-surface text-foreground/80 hover:bg-muted",
      )}
    >
      {label}
      <span className="font-medium text-muted-foreground">{count ?? "·"}</span>
    </button>
  );
}

function AssigneeCell({ item, allBranches }: { item: TaskListItem; allBranches: boolean }) {
  return (
    <span className="break-words">
      {item.assignee.displayName}
      {allBranches && item.branchName ? <span className="text-foreground/80"> · {item.branchName}</span> : null}
    </span>
  );
}

/** Таблица на ПК, карточки на телефоне. Строка целиком — ссылка на карточку (Enter открывает). */
function TaskTable({ data, onOpen }: { data: TaskList; onOpen: () => void }) {
  const router = useRouter();
  const open = (id: string) => {
    onOpen();
    router.push(`/tasks/${id}`);
  };
  return (
    <>
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full table-fixed border-collapse text-[15px]">
          <thead className="bg-muted/60 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-16 px-4 py-3">№</th>
              <th className="px-4 py-3">{t("tasks.columns.title")}</th>
              <th className="w-[22%] px-4 py-3">{t("tasks.columns.assignee")}</th>
              <th className="w-[19%] px-4 py-3">{t("tasks.columns.due")}</th>
              <th className="w-40 px-4 py-3">{t("tasks.columns.status")}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((task) => (
              <tr
                key={task.id}
                tabIndex={0}
                onClick={() => open(task.id)}
                onKeyDown={(e) => e.key === "Enter" && open(task.id)}
                className={cn("cursor-pointer border-t border-border hover:bg-muted/50 focus-visible:bg-selected", task.cancelled && "opacity-70")}
              >
                <td className="px-4 py-3.5 text-muted-foreground">#{task.number}</td>
                <td className="px-4 py-3.5 font-semibold">
                  <Link href={`/tasks/${task.id}`} onClick={(e) => {
                      e.stopPropagation();
                      onOpen();
                    }} tabIndex={-1} className="break-words">
                    {task.title}
                  </Link>
                </td>
                <td className="px-4 py-3.5">
                  <AssigneeCell item={task} allBranches={data.allBranches} />
                </td>
                <td className="px-4 py-3.5">
                  <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={data.timezone} />
                </td>
                <td className="px-4 py-3.5">
                  <StatusPill status={task.status} cancelledName={task.cancelled ? data.cancelledName : null} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <ul className="flex flex-col gap-2 md:hidden">
        {data.items.map((task) => (
          <li key={task.id}>
            <Link href={`/tasks/${task.id}`} onClick={onOpen} className="block rounded-lg">
              <Card className={cn("flex flex-col gap-1.5 p-3.5", task.cancelled && "opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words font-semibold">{task.title}</p>
                  <span className="shrink-0 text-sm text-muted-foreground">#{task.number}</span>
                </div>
                <p className="text-sm text-foreground/80">
                  <AssigneeCell item={task} allBranches={data.allBranches} />
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={data.timezone} />
                  <StatusPill status={task.status} cancelledName={task.cancelled ? data.cancelledName : null} />
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Канбан: колонки по статусам из той же выдачи. Переходы — через меню «…» карточки (на телефоне и с клавиатуры тоже). */
function Board({ data, onOpen, onChanged }: { data: TaskList; onOpen: () => void; onChanged: () => void }) {
  const items = data.items.filter((i) => !i.cancelled);
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <div className="grid min-w-[880px] items-start gap-3" style={{ gridTemplateColumns: `repeat(${data.statuses.length}, minmax(200px, 1fr))` }}>
        {data.statuses.map((s) => {
          const col = items.filter((i) => i.status.key === s.key);
          return (
            <section key={s.key} aria-label={s.name} className="rounded-xl border border-border bg-muted/50 p-2">
              <h2 className="flex items-center gap-2 px-1.5 pb-2 pt-1 text-[15px] font-bold">
                {s.name} <span className="font-semibold text-muted-foreground">{col.length}</span>
              </h2>
              {col.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("tasks.board.empty")}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {col.map((task) => (
                    <li key={task.id}>
                      <BoardCard task={task} data={data} onOpen={onOpen} onChanged={onChanged} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({ task, data, onOpen, onChanged }: { task: TaskListItem; data: TaskList; onOpen: () => void; onChanged: () => void }) {
  const [card, setCard] = React.useState<TaskCard | null>(null);
  const [dialog, setDialog] = React.useState<TransitionInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const act = useTaskAction(setCard);
  const router = useRouter();

  const loadCard = async () => {
    setError(null);
    try {
      setCard(await api<TaskCard>("GET", `/api/tasks/${task.id}`));
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : "network"));
    }
  };

  const run = async (tr: TransitionInfo) => {
    if (!card) return;
    if (tr.requires.comment || tr.requires.result) {
      setDialog(tr);
      return;
    }
    try {
      await act("POST", `/api/tasks/${task.id}/status`, { to: tr.to }, card.task.version);
      onChanged();
    } catch (e) {
      setError(errorText(e instanceof ApiError ? e.code : "network"));
      onChanged();
    }
  };

  return (
    <Card className="relative p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <Link href={`/tasks/${task.id}`} onClick={onOpen} className="min-w-0 flex-1 break-words font-semibold leading-snug after:absolute after:inset-0">
          {task.title}
        </Link>
        <DropdownMenu.Root onOpenChange={(o) => o && void loadCard()}>
          <DropdownMenu.Trigger
            className="relative z-10 -mr-1 -mt-0.5 rounded-md p-1 text-foreground/70 hover:bg-muted"
            aria-label={`${t("tasks.board.menu")}: ${task.title}`}
          >
            <MoreHorizontal className="size-5" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-52 rounded-lg border border-border bg-surface p-1 shadow-lg">
              <DropdownMenu.Item
                onSelect={() => {
                  onOpen();
                  router.push(`/tasks/${task.id}`);
                }}
                className="cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted"
              >
                {t("tasks.board.open")}
              </DropdownMenu.Item>
              {!card ? (
                <div className="flex items-center gap-2 px-2.5 py-2 text-sm text-muted-foreground">
                  <Spinner /> {t("app.loading")}
                </div>
              ) : (
                card.transitions.map((tr) => (
                  <DropdownMenu.Item
                    key={tr.to}
                    onSelect={() => void run(tr)}
                    className="cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-muted"
                  >
                    {transitionLabel(tr, card.task.status.category)}
                  </DropdownMenu.Item>
                ))
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-sm text-foreground/75">
        <span className="min-w-0 truncate">{task.assignee.displayName}</span>
        <span className="shrink-0 text-muted-foreground">#{task.number}</span>
      </div>
      <DueText dueAt={task.dueAt} overdue={task.overdue} timeZone={data.timezone} className="mt-1 block" />
      {error ? <p className="relative z-10 mt-1 text-xs text-destructive">{error}</p> : null}
      {card ? (
        <StatusDialog
          card={card}
          transition={dialog}
          open={Boolean(dialog)}
          onOpenChange={(o) => !o && setDialog(null)}
          act={act}
          setCard={setCard}
          onDone={() => onChanged()}
        />
      ) : null}
    </Card>
  );
}
