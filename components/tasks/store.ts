"use client";

/**
 * Клиентский кэш задач: список и карточка показываются сразу из памяти, а свежие данные
 * подтягиваются в фоне — без «Загрузка…» и без мигания. Изменение в карточке сразу
 * отражается в строке списка; счётчики обновляются тихо.
 */
import * as React from "react";
import { api, ApiError } from "@/lib/api";
import { errorText } from "@/lib/i18n";
import type { TaskCard, TaskList, TaskListItem } from "./types";

type Entry<T> = { data: T; at: number };

const lists = new Map<string, Entry<TaskList>>();
const cards = new Map<string, Entry<TaskCard>>();
const items = new Map<string, TaskListItem>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
/** Меняется при любом изменении кэша — подписчики перерисовываются. */
let version = 0;
/** Меняется, когда списки устарели — открытые списки обновляются в фоне. */
let generation = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

function indexList(list: TaskList) {
  for (const item of list.items) items.set(item.id, item);
}

/** Строка списка из карточки (после изменения или создания). */
export function itemFromCard(card: TaskCard, prev?: TaskListItem): TaskListItem {
  const t = card.task;
  return {
    id: t.id,
    number: t.number,
    branchId: t.branchId,
    title: t.title,
    status: t.status,
    assignee: {
      id: t.assignee.id,
      displayName: t.assignee.displayName ?? prev?.assignee.displayName ?? "—",
      self: prev?.assignee.self ?? false,
    },
    branchName: t.branchName,
    dueDate: t.dueDate,
    dueAt: t.dueAt,
    overdue: t.overdue,
    isPersonal: t.isPersonal,
    cancelled: Boolean(t.cancelledAt),
    checklist: {
      total: t.checklist.length,
      done: t.checklist.filter((c) => c.done).length,
    },
    version: t.version,
    moves: card.transitions.map((tr) => ({
      to: tr.to,
      toName: tr.toName,
      kind: tr.kind,
      needsForm: tr.requires.comment || tr.requires.result,
    })),
    primary: card.primary,
  };
}

/** Карточка изменилась: обновить её, строку во всех списках и тихо пересчитать счётчики. */
export function applyCard(card: TaskCard, selfId?: string) {
  cards.set(card.task.id, { data: card, at: Date.now() });
  for (const entry of lists.values()) {
    const i = entry.data.items.findIndex((x) => x.id === card.task.id);
    if (i < 0) continue;
    const prev = entry.data.items[i]!;
    const next = itemFromCard(card, prev);
    if (selfId) next.assignee.self = next.assignee.id === selfId;
    const copy = entry.data.items.slice();
    copy[i] = next;
    entry.data = { ...entry.data, items: copy };
    items.set(next.id, next);
  }
  invalidateLists();
}

/** Временно заменить строку (мгновенный отклик до ответа сервера). */
export function patchItem(id: string, patch: Partial<TaskListItem>) {
  for (const entry of lists.values()) {
    const i = entry.data.items.findIndex((x) => x.id === id);
    if (i < 0) continue;
    const copy = entry.data.items.slice();
    copy[i] = { ...copy[i]!, ...patch };
    entry.data = { ...entry.data, items: copy };
  }
  emit();
}

/** Ключ строки не меняется, когда временная строка заменяется настоящей — без повторной анимации. */
const aliases = new Map<string, string>();
export function linkKey(realId: string, tempId: string) {
  aliases.set(realId, tempId);
}
export function rowKey(id: string): string {
  return aliases.get(id) ?? id;
}

/** Новая задача — сразу в начало открытого списка. */
export function prependItem(query: string, item: TaskListItem) {
  const entry = lists.get(query);
  if (!entry) return;
  entry.data = {
    ...entry.data,
    items: [item, ...entry.data.items.filter((x) => x.id !== item.id)],
  };
  items.set(item.id, item);
  emit();
}

export function replaceItem(query: string, tempId: string, item: TaskListItem | null) {
  const entry = lists.get(query);
  if (!entry) return;
  entry.data = {
    ...entry.data,
    items: item ? entry.data.items.map((x) => (x.id === tempId ? item : x)) : entry.data.items.filter((x) => x.id !== tempId),
  };
  if (item) items.set(item.id, item);
  emit();
}

/** Списки устарели (счётчики, фильтры): открытые обновятся в фоне, остальные — при открытии. */
export function invalidateLists() {
  for (const entry of lists.values()) entry.at = 0;
  generation++;
  emit();
}

/** Карточка заранее — при наведении на строку, чтобы открылась мгновенно. */
export function prefetchCard(id: string) {
  const cached = cards.get(id);
  if (cached && Date.now() - cached.at < 15_000) return;
  void once(`card:${id}`, () => api<TaskCard>("GET", `/api/tasks/${id}`))
    .then((card) => {
      cards.set(id, { data: card, at: Date.now() });
      emit();
    })
    .catch(() => {});
}

export function loadCard(id: string): Promise<TaskCard> {
  return once(`card:${id}`, () => api<TaskCard>("GET", `/api/tasks/${id}`)).then((card) => {
    cards.set(id, { data: card, at: Date.now() });
    emit();
    return card;
  });
}

function useStore() {
  return React.useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}

/** Список задач по запросу: данные из кэша сразу, свежие — в фоне. */
export function useTaskList(query: string | null, epoch = 0) {
  useStore();
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const shown = React.useRef<TaskList | null>(null);
  const gen = generation;

  const refresh = React.useCallback(() => {
    if (!query) return;
    setRefreshing(true);
    once(`list:${query}`, () => api<TaskList>("GET", `/api/tasks?${query}`))
      .then((data) => {
        lists.set(query, { data, at: Date.now() });
        indexList(data);
        setError(null);
        emit();
      })
      .catch((e) => {
        if ((e as Error).name === "AbortError") return;
        if (!lists.get(query)) setError(errorText(e instanceof ApiError ? e.code : "network"));
      })
      .finally(() => setRefreshing(false));
  }, [query]);

  React.useEffect(() => {
    if (!query) return;
    const entry = lists.get(query);
    if (!entry || Date.now() - entry.at > 4_000) refresh();
  }, [query, refresh, epoch, gen]);

  const entry = query ? lists.get(query) : undefined;
  if (entry) shown.current = entry.data;
  // Пока грузится новая выдача (другой фильтр), остаётся прежняя — без пустого экрана.
  return {
    data: entry?.data ?? shown.current,
    exact: Boolean(entry),
    error,
    refreshing,
    refresh,
  };
}

/** Карточка: из кэша сразу (или заготовка из строки списка), актуальная — в фоне. */
export function useTaskCard(id: string) {
  useStore();
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    setLoadError(null);
    loadCard(id).catch((e) => {
      if (!cards.get(id)) setLoadError(e instanceof ApiError ? e.code : "network");
    });
  }, [id]);
  React.useEffect(load, [load]);
  const setCard = React.useCallback((card: TaskCard) => applyCard(card), []);
  return {
    card: cards.get(id)?.data ?? null,
    preview: items.get(id) ?? null,
    setCard,
    load,
    loadError,
  };
}
