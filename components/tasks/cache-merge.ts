import type { TaskList, TaskListItem } from "./types.ts";

export function replaceInList(data: TaskList, id: string, next: TaskListItem): TaskList {
  const before = data.items.find((x) => x.id === id);
  if (!before) return data;
  const counts = { ...data.counts, byStatus: { ...data.counts.byStatus } };
  if (!before.cancelled) counts.byStatus[before.status.key] = Math.max(0, (counts.byStatus[before.status.key] ?? 0) - 1);
  if (!next.cancelled) counts.byStatus[next.status.key] = (counts.byStatus[next.status.key] ?? 0) + 1;
  counts.overdue = Math.max(0, counts.overdue + Number(next.overdue && !next.cancelled) - Number(before.overdue && !before.cancelled));
  counts.cancelled = Math.max(0, counts.cancelled + Number(next.cancelled) - Number(before.cancelled));
  return { ...data, counts, items: data.items.map((x) => x.id === id ? next : x) };
}

/** A GET that started before a save cannot move the card back to the old column. */
export function mergeTaskList(remote: TaskList, localItems: Map<string, TaskListItem>, shown: TaskListItem[] = []): TaskList {
  let merged = remote;
  for (const item of remote.items) {
    const local = localItems.get(item.id);
    if (local && (local.saving || local.version > item.version)) merged = replaceInList(merged, item.id, local);
  }
  for (const item of shown) {
    if ((item.saving || item.id.startsWith("new-")) && !merged.items.some((x) => x.id === item.id)) {
      merged = { ...merged, items: [item, ...merged.items] };
    }
  }
  return merged;
}
