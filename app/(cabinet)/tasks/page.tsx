"use client";

import { Building2, ListTodo, Plus, Search, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { BranchDialog } from "@/components/cabinet/branch-dialog";
import { useCabinet } from "@/components/cabinet/cabinet-context";
import { EmptyState, PageHeader } from "@/components/cabinet/page-header";
import { LoadError } from "@/components/forms";
import { CreateTaskDialog, useAssignees } from "@/components/tasks/create-task-dialog";
import { DueLabel, StatusBadge } from "@/components/tasks/labels";
import type { TaskList } from "@/components/tasks/types";
import { Button } from "@/components/ui/button";
import { Card, Spinner } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { errorText, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Filters = { view: "" | "mine" | "all"; q: string; status: string; assignee: string; due: string };
const EMPTY: Filters = { view: "", q: "", status: "", assignee: "", due: "" };
const SCROLL_KEY = "am.tasks.scroll";

function readFilters(): Filters {
  if (typeof window === "undefined") return EMPTY;
  const p = new URLSearchParams(window.location.search);
  return {
    view: (p.get("view") as Filters["view"]) || "",
    q: p.get("q") ?? "",
    status: p.get("status") ?? "",
    assignee: p.get("assignee") ?? "",
    due: p.get("due") ?? "",
  };
}

function toQuery(f: Filters, branchId: string | null): string {
  const p = new URLSearchParams();
  if (branchId) p.set("branch", branchId);
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  return p.toString();
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
  const assignees = useAssignees(branchId, me.capabilities.assignOthers);

  // Восстановление фильтров и филиала из адреса (возврат из карточки, ссылка).
  React.useEffect(() => {
    const f = readFilters();
    setFilters(f);
    setSearchDraft(f.q);
    const urlBranch = new URLSearchParams(window.location.search).get("branch");
    if (urlBranch && urlBranch !== branchId && me.branches.some((b) => b.id === urlBranch)) setBranchId(urlBranch);
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = toQuery(filters, branchId);

  // Адрес отражает филиал и фильтры: «Назад» из карточки возвращает ту же выдачу.
  React.useEffect(() => {
    if (!ready) return;
    const next = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(window.history.state, "", next);
  }, [query, ready]);

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
        if (q === query) window.scrollTo(0, y);
        sessionStorage.removeItem(SCROLL_KEY);
      }
    } catch {
      /* хранилище недоступно */
    }
  }, [data, query]);

  const rememberScroll = () => {
    try {
      sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ q: query, y: window.scrollY }));
    } catch {
      /* хранилище недоступно */
    }
  };

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const hasFilters = Boolean(filters.q || filters.status || filters.assignee || filters.due);

  if (me.branches.length === 0) {
    return (
      <>
        <PageHeader title={t("tasks.title")} />
        <EmptyState
          icon={<Building2 className="size-8" />}
          title={t("branch.none")}
          text={t("branch.createHint")}
          action={
            me.capabilities.manageBranches ? (
              <Button onClick={() => setCreatingBranch(true)}>
                <Plus />
                {t("branch.create")}
              </Button>
            ) : null
          }
        />
        <BranchDialog
          open={creatingBranch}
          onOpenChange={setCreatingBranch}
          onSaved={async (b) => {
            await refreshMe();
            setBranchId(b.id);
          }}
        />
      </>
    );
  }

  const view = data?.view ?? (filters.view || "mine");

  return (
    <>
      <PageHeader
        title={t("tasks.title")}
        actions={
          <Button onClick={() => setCreating(true)} disabled={!branchId}>
            <Plus />
            {t("tasks.create")}
          </Button>
        }
      />

      <div className="mb-3 flex flex-col gap-3">
        {data?.viewsDiffer ? (
          <div role="group" aria-label={t("tasks.views.all")} className="inline-flex w-fit rounded-md border border-border bg-surface p-0.5">
            {(["mine", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => set({ view: v })}
                className={cn("rounded px-3 py-1.5 text-sm", view === v ? "bg-selected font-medium text-primary" : "text-muted-foreground hover:bg-muted")}
              >
                {t(`tasks.views.${v}`)}
              </button>
            ))}
          </div>
        ) : null}

        <form
          role="search"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q: searchDraft.trim() });
          }}
        >
          <Input
            ref={searchRef}
            type="search"
            value={searchDraft}
            onChange={(e) => {
              setSearchDraft(e.target.value);
              if (!e.target.value) set({ q: "" });
            }}
            placeholder={t("tasks.search")}
            aria-label={t("tasks.search")}
          />
          <Button type="submit" variant="outline" aria-label={t("tasks.searchButton")}>
            <Search />
            <span className="hidden sm:inline">{t("tasks.searchButton")}</span>
          </Button>
        </form>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <NativeSelect aria-label={t("tasks.filters.status")} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">{t("tasks.filters.statusAll")}</option>
            {(data?.statuses ?? me.statuses).map((s) => (
              <option key={s.key} value={s.key}>
                {s.name}
              </option>
            ))}
            <option value="_cancelled">{t("tasks.filters.cancelled")}</option>
          </NativeSelect>
          {me.capabilities.assignOthers ? (
            <NativeSelect aria-label={t("tasks.filters.assignee")} value={filters.assignee} onChange={(e) => set({ assignee: e.target.value })}>
              <option value="">{t("tasks.filters.assigneeAll")}</option>
              {(assignees ?? []).map((a) => (
                <option key={a.userId} value={a.self ? "me" : a.userId}>
                  {a.self ? t("tasks.form.assigneeSelf", { name: a.displayName }) : a.displayName}
                </option>
              ))}
            </NativeSelect>
          ) : null}
          <NativeSelect aria-label={t("tasks.filters.due")} value={filters.due} onChange={(e) => set({ due: e.target.value })}>
            <option value="">{t("tasks.filters.dueAll")}</option>
            <option value="overdue">{t("tasks.filters.overdue")}</option>
            <option value="today">{t("tasks.filters.today")}</option>
            <option value="week">{t("tasks.filters.week")}</option>
            <option value="has">{t("tasks.filters.has")}</option>
            <option value="none">{t("tasks.filters.none")}</option>
          </NativeSelect>
        </div>

        {data ? (
          <div className="flex flex-wrap gap-2 text-xs" aria-live="polite">
            {data.statuses.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={filters.status === s.key}
                onClick={() => set({ status: filters.status === s.key ? "" : s.key })}
                className={cn(
                  "rounded-full border px-3 py-1",
                  filters.status === s.key ? "border-primary bg-selected text-primary" : "border-border bg-surface hover:bg-muted",
                )}
              >
                {s.name}: <span className="font-semibold">{data.counts.byStatus[s.key] ?? 0}</span>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={filters.due === "overdue"}
              onClick={() => set({ due: filters.due === "overdue" ? "" : "overdue" })}
              className={cn(
                "rounded-full border px-3 py-1",
                filters.due === "overdue" ? "border-destructive bg-destructive/10 text-destructive" : "border-border bg-surface hover:bg-muted",
              )}
            >
              {t("tasks.counts.overdue", { n: data.counts.overdue })}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <LoadError message={error} onRetry={load} />
      ) : !data || (loading && !data) ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner /> {t("app.loading")}
        </div>
      ) : data.items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={<SearchX className="size-8" />}
            title={t("tasks.noMatches")}
            text={t("tasks.noMatchesText")}
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSearchDraft("");
                  setFilters((f) => ({ ...EMPTY, view: f.view }));
                }}
              >
                {t("tasks.resetFilters")}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<ListTodo className="size-8" />}
            title={t("tasks.emptyTitle")}
            text={view === "mine" && data.viewsDiffer ? t("tasks.emptyMine") : t("tasks.emptyText")}
            action={
              <Button onClick={() => setCreating(true)}>
                <Plus />
                {t("tasks.create")}
              </Button>
            }
          />
        )
      ) : (
        <div className={cn("transition-opacity", loading && "opacity-60")} aria-busy={loading}>
          <ul className="flex flex-col gap-2">
            {data.items.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/tasks/${task.id}`}
                  onClick={rememberScroll}
                  className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Card className={cn("flex flex-col gap-2 p-3 hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between", task.cancelled && "opacity-70")}>
                    <div className="min-w-0 flex-1">
                      <p className="break-words font-medium">
                        <span className="mr-2 text-xs font-normal text-muted-foreground">{t("tasks.number", { n: task.number })}</span>
                        {task.title}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="break-words">{task.assignee.displayName}</span>
                        <DueLabel dueDate={task.dueDate} overdue={task.overdue} today={data.today} />
                        {task.checklist.total ? (
                          <span>{t("tasks.checklistShort", { done: task.checklist.done, total: task.checklist.total })}</span>
                        ) : null}
                      </p>
                    </div>
                    <StatusBadge status={task.status} cancelled={task.cancelled} className="w-fit shrink-0" />
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
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
    </>
  );
}
