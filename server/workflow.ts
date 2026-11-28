/**
 * Статусы и переходы компании (таблицы task_statuses / status_transitions,
 * заполняются из config/company.ts при создании компании).
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import type { StatusCategory, TransitionActor } from "../config/company";
import type { Actor } from "./context";
import { getDb, schema } from "./db";
import { isDirector, isManager } from "./permissions";

export type Status = { key: string; name: string; category: StatusCategory; sort: number };
export type Transition = {
  from: string;
  to: string;
  actors: TransitionActor[];
  requires: { comment?: boolean; result?: boolean; attachment?: boolean; confirm?: string };
};
export type Workflow = {
  statuses: Status[];
  transitions: Transition[];
  initial: string;
  byKey: Map<string, Status>;
};

export async function loadWorkflow(companyId: string): Promise<Workflow> {
  const db = getDb();
  const [statusRows, transitionRows] = await Promise.all([
    db
      .select()
      .from(schema.taskStatuses)
      .where(and(eq(schema.taskStatuses.companyId, companyId), isNull(schema.taskStatuses.archivedAt)))
      .orderBy(asc(schema.taskStatuses.sort)),
    db.select().from(schema.statusTransitions).where(eq(schema.statusTransitions.companyId, companyId)),
  ]);
  const statuses = statusRows.map((s) => ({ key: s.key, name: s.name, category: s.category, sort: s.sort }));
  const transitions = transitionRows.map((t) => ({
    from: t.fromKey,
    to: t.toKey,
    actors: JSON.parse(t.actorsJson) as TransitionActor[],
    requires: JSON.parse(t.requiresJson) as Transition["requires"],
  }));
  const initial = statuses.find((s) => s.category === "open")?.key ?? statuses[0]?.key ?? "new";
  return { statuses, transitions, initial, byKey: new Map(statuses.map((s) => [s.key, s])) };
}

export type TaskRef = { branchId: string; assigneeId: string; creatorId: string; statusKey: string; cancelledAt: number | null };

/** В каких ролях участник выступает по отношению к задаче. */
export function actorRoles(actor: Actor, task: TaskRef): Set<TransitionActor> {
  const roles = new Set<TransitionActor>();
  if (task.assigneeId === actor.user.id) roles.add("assignee");
  if (task.creatorId === actor.user.id) roles.add("creator");
  if (isManager(actor) && actor.membership.branchId === task.branchId) roles.add("manager");
  if (isDirector(actor) && actor.branches.some((b) => b.id === task.branchId)) roles.add("director");
  return roles;
}

/** Переходы, доступные участнику из текущего статуса задачи. */
export function allowedTransitions(actor: Actor, task: TaskRef, wf: Workflow): Transition[] {
  if (task.cancelledAt) return [];
  const roles = actorRoles(actor, task);
  return wf.transitions.filter(
    (t) => t.from === task.statusKey && wf.byKey.has(t.to) && t.actors.some((a) => roles.has(a)),
  );
}

export function isDoneCategory(wf: Workflow, key: string): boolean {
  return wf.byKey.get(key)?.category === "done";
}
