/**
 * Операции для будущего плагина директора (сам плагин не входит в проект).
 * Это тонкий слой над теми же операциями, что использует сайт: права проверяются так же,
 * Actor загружается из БД (loadActorForSession / loadActorForUser) на каждый вызов.
 */
import type { Actor } from "../context";
import { newId } from "../crypto";
import { getStats } from "./stats";
import { changeStatus, createTask, getTaskCard, listTasks, searchAssignees, updateTask } from "./tasks";

/** Поиск задач: текст, номер, исполнитель, статус, срок — в пределах прав участника. */
export function findTasks(actor: Actor, query: { branch?: string | null; q?: string; assignee?: string; status?: string[]; due?: "overdue" | "today" | "week" | "none" | "has" }) {
  return listTasks(actor, { branch: query.branch ?? "all", view: "all", q: query.q ?? null, assignee: query.assignee ?? null, status: query.status, due: query.due ?? null, limit: 100 });
}

/** Поиск исполнителей филиала по имени. */
export function findAssignees(actor: Actor, branchId: string, q: string) {
  return searchAssignees(actor, branchId, q);
}

/** Назначение: новая задача участнику филиала. */
export function assign(actor: Actor, input: { branchId: string; assigneeId: string; title: string; dueDate?: string | null; dueTime?: string | null; description?: string | null }) {
  return createTask(actor, { opId: newId(), ...input });
}

/** Переназначение на другого исполнителя (с записью в историю и уведомлением). */
export async function reassign(actor: Actor, taskId: string, assigneeId: string) {
  const card = await getTaskCard(actor, taskId);
  return updateTask(actor, taskId, { opId: newId(), version: card.task.version, assigneeId });
}

/** Проверка результата: принять или вернуть на доработку с комментарием. */
export async function review(actor: Actor, taskId: string, decision: "accept" | "return", comment?: string) {
  const card = await getTaskCard(actor, taskId);
  const target = card.transitions.find((t) => (decision === "accept" ? t.kind === "accepted" : t.kind === "returned"));
  if (!target) return { ok: false as const, reason: "transition_forbidden", status: card.task.status.name };
  await changeStatus(actor, taskId, { opId: newId(), version: card.task.version, to: target.to, comment: comment ?? null });
  return { ok: true as const };
}

/** Сводка компании или филиала и детализация до исходных задач (ids в каждом показателе). */
export function summary(actor: Actor, query: { from: string; to: string; branch?: string | null; assignee?: string | null }) {
  return getStats(actor, { ...query, snapshot: "now" });
}

/** Карточка задачи с историей — детализация показателя. */
export function taskDetails(actor: Actor, taskId: string) {
  return getTaskCard(actor, taskId);
}
