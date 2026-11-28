import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeTaskList, replaceInList } from "../components/tasks/cache-merge.ts";
import { needsTransitionForm } from "../lib/task-transition.ts";
import type { TaskList, TaskListItem } from "../components/tasks/types.ts";

const task = (id: string, status = "new"): TaskListItem => ({ id, number: 1, branchId: "b", title: id, status: { key: status, name: status, category: status === "done" ? "done" : "open" }, assignee: { id: "u", displayName: "User", self: true }, branchName: "Branch", dueDate: null, dueAt: null, overdue: false, isPersonal: true, cancelled: false, checklist: { done: 0, total: 0 }, version: 1, moves: [], primary: null });
const list = (items: TaskListItem[]): TaskList => ({ items, hasMore: false, view: "all", viewsDiffer: true, counts: { byStatus: { new: items.length }, overdue: 0, cancelled: 0, total: items.length }, statuses: [], cancelledName: "Cancelled", allBranches: false, timezone: "UTC", today: "2026-11-28", snapshotAt: 0 });

test("A slow refresh cannot undo a pending drag; counters match the visible columns", () => {
  const before = task("a");
  const pending = { ...task("a", "done"), saving: true };
  const result = mergeTaskList(list([before]), new Map([["a", pending]]));
  assert.equal(result.items[0]?.status.key, "done");
  assert.equal(result.items[0]?.saving, true);
  assert.equal(result.counts.byStatus.new, 0);
  assert.equal(result.counts.byStatus.done, 1);
});

test("A server-confirmed newer version survives a late GET", () => {
  const saved = { ...task("a", "done"), version: 2 };
  assert.equal(mergeTaskList(list([task("a")]), new Map([["a", saved]])).items[0]?.version, 2);
});

test("Rollback restores the failed task without undoing a different successful task", () => {
  const first = task("a");
  let data = replaceInList(list([first, task("b")]), "a", { ...task("a", "done"), saving: true });
  data = replaceInList(data, "b", { ...task("b", "done"), version: 2 });
  data = replaceInList(data, "a", first);
  assert.deepEqual(data.items.map((item) => item.status.key), ["new", "done"]);
  assert.deepEqual(data.counts.byStatus, { new: 1, done: 1 });
});

test("Tasks being created are not lost when an older list response arrives", () => {
  const created = task("new-op");
  const pending = { ...task("a"), saving: true };
  assert.deepEqual(mergeTaskList(list([]), new Map(), [created, pending]).items.map((item) => item.id).sort(), ["a", "new-op"]);
});

test("Optional reports do not open a dialog; required text, comments, and missing files do", () => {
  const optional = { comment: false, resultText: false, attachment: false };
  assert.equal(needsTransitionForm(optional, 0), false);
  assert.equal(needsTransitionForm({ ...optional, resultText: true }, 1), true);
  assert.equal(needsTransitionForm({ ...optional, comment: true }, 1), true);
  assert.equal(needsTransitionForm({ ...optional, attachment: true }, 0), true);
  assert.equal(needsTransitionForm({ ...optional, attachment: true }, 1), false);
});
