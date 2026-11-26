/**
 * Статистика (раздел 9 ТЗ). Сервер сначала ограничивает данные правами участника, потом считает.
 *
 * Состояние задачи на любой момент восстанавливается по истории (task_events хранит снимок
 * исполнителя, срока и статуса после каждого события). Для открытой задачи берутся исполнитель
 * и срок на момент среза, для завершённой — на момент завершения. Повторное открытие и отмена учитываются.
 * Сводка компании считается по исходным задачам, а не усреднением процентов.
 */
import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { Actor } from "../context";
import { getDb, schema } from "../db";
import { AppError, forbidden } from "../errors";
import { isDirector, isManager, resolveBranchScope } from "../permissions";
import { dateInZone, dueMomentInZone } from "../time";
import { loadWorkflow } from "../workflow";

export const statsQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branch: z.string().max(80).optional().nullable(),
  assignee: z.string().max(80).optional().nullable(),
  snapshot: z.enum(["now", "end"]).optional().nullable(),
});

export function parseStatsQuery(url: URL) {
  const p = url.searchParams;
  return statsQuerySchema.parse({
    from: p.get("from"),
    to: p.get("to"),
    branch: p.get("branch"),
    assignee: p.get("assignee"),
    snapshot: p.get("snapshot"),
  });
}

type Point = { at: number; type: string; statusKey: string | null; assigneeId: string | null; dueAt: number | null };

/** Медиана; n — число наблюдений. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

type Bucket = {
  open: string[];
  openNew: string[];
  openProgress: string[];
  review: string[];
  overdue: string[];
  denom: string[];
  done: string[];
  notDone: string[];
  completed: string[];
  onTime: string[];
  late: string[];
  early: string[];
  earlyLeads: number[];
  speedIds: string[];
  speeds: number[];
};

const emptyBucket = (): Bucket => ({
  open: [],
  openNew: [],
  openProgress: [],
  review: [],
  overdue: [],
  denom: [],
  done: [],
  notDone: [],
  completed: [],
  onTime: [],
  late: [],
  early: [],
  earlyLeads: [],
  speedIds: [],
  speeds: [],
});

function summarize(b: Bucket) {
  return {
    open: { n: b.open.length, ids: b.open, new: b.openNew.length, progress: b.openProgress.length },
    review: { n: b.review.length, ids: b.review },
    overdue: { n: b.overdue.length, ids: b.overdue },
    done: { n: b.done.length, ids: b.done, denom: b.denom.length, denomIds: b.denom },
    notDone: { n: b.notDone.length, ids: b.notDone, denom: b.denom.length },
    onTime: { n: b.onTime.length, ids: b.onTime },
    late: { n: b.late.length, ids: b.late },
    completed: { n: b.completed.length, ids: b.completed },
    speed: { medianMs: median(b.speeds), n: b.speeds.length, ids: b.speedIds },
    early: { n: b.early.length, ids: b.early, medianLeadMs: median(b.earlyLeads) },
  };
}

export async function getStats(actor: Actor, query: z.infer<typeof statsQuerySchema>) {
  if (!isDirector(actor) && !isManager(actor)) throw forbidden();
  const tz = actor.company.timezone;
  if (query.from > query.to) throw new AppError("validation", 400, { fields: { from: "period_invalid" } });
  const startAt = dueMomentInZone(query.from, "00:00", tz) - 59_999;
  const endAt = dueMomentInZone(query.to, "23:59", tz);
  const now = Date.now();
  const S = query.snapshot === "end" ? Math.min(endAt, now) : now;

  // 1. Права: только доступные филиалы.
  const branchIds = resolveBranchScope(actor, query.branch || "all");
  if (branchIds.length === 0) throw new AppError("no_branches", 409);
  const db = getDb();
  const wf = await loadWorkflow(actor.company.id);
  const cat = (key: string | null) => (key ? wf.byKey.get(key)?.category : undefined) ?? "open";

  const tasks = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      title: schema.tasks.title,
      branchId: schema.tasks.branchId,
      createdAt: schema.tasks.createdAt,
    })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.companyId, actor.company.id), inArray(schema.tasks.branchId, branchIds), lte(schema.tasks.createdAt, S)));
  const events = await db
    .select({
      taskId: schema.taskEvents.taskId,
      at: schema.taskEvents.createdAt,
      type: schema.taskEvents.type,
      statusKey: schema.taskEvents.statusKey,
      assigneeId: schema.taskEvents.assigneeId,
      dueAt: schema.taskEvents.dueAt,
    })
    .from(schema.taskEvents)
    .where(and(eq(schema.taskEvents.companyId, actor.company.id), inArray(schema.taskEvents.branchId, branchIds), lte(schema.taskEvents.createdAt, S)))
    .orderBy(asc(schema.taskEvents.createdAt));

  const byTask = new Map<string, Point[]>();
  for (const e of events) {
    const list = byTask.get(e.taskId) ?? [];
    list.push({ at: e.at, type: e.type, statusKey: e.statusKey, assigneeId: e.assigneeId, dueAt: e.dueAt });
    byTask.set(e.taskId, list);
  }

  // 2. Восстановление состояния каждой задачи на момент среза.
  const total = emptyBucket();
  const perUser = new Map<string, Bucket>();
  const bucketOf = (userId: string) => {
    let b = perUser.get(userId);
    if (!b) perUser.set(userId, (b = emptyBucket()));
    return b;
  };
  const taskInfo = new Map<string, { assigneeId: string; statusKey: string; dueAt: number | null; cancelled: boolean }>();
  const inPeriod = (t: number) => t >= startAt && t <= endAt;

  for (const task of tasks) {
    const points = byTask.get(task.id);
    if (!points?.length) continue;
    let cancelled = false;
    let state = points[0]!;
    let completion: Point | null = null;
    let started: number | null = null;
    let assignedAt: number | null = points[0]!.at;
    let prevCat = "open";
    for (const p of points) {
      if (p.type === "cancelled") cancelled = true;
      if (p.type === "restored") cancelled = false;
      if (p.type === "assigned") assignedAt = p.at;
      const c = cat(p.statusKey);
      if (c === "progress" && started === null) started = p.at;
      if (c === "done" && prevCat !== "done") completion = p;
      if (c !== "done") completion = null; // повторное открытие
      prevCat = c;
      state = p;
    }
    const doneAtS = cat(state.statusKey) === "done";
    // Для завершённой — исполнитель и срок на момент завершения, для открытой — на момент среза.
    const ref = doneAtS && completion ? completion : state;
    const assigneeId = ref.assigneeId ?? "";
    taskInfo.set(task.id, { assigneeId, statusKey: state.statusKey ?? "", dueAt: ref.dueAt, cancelled });
    if (cancelled) continue;
    if (query.assignee && assigneeId !== query.assignee) continue;

    const targets = [total, bucketOf(assigneeId)];
    const push = (key: keyof Bucket, value: string) => {
      for (const b of targets) (b[key] as string[]).push(value);
    };

    if (!doneAtS) {
      push("open", task.id);
      const c = cat(state.statusKey);
      if (c === "review") push("review", task.id);
      else if (c === "progress") push("openProgress", task.id);
      else push("openNew", task.id);
      if (state.dueAt !== null && state.dueAt < S) push("overdue", task.id);
    }

    // Выполнено / не выполнено: срок в периоде и уже наступил к срезу.
    if (ref.dueAt !== null && inPeriod(ref.dueAt) && ref.dueAt <= S) {
      push("denom", task.id);
      push(doneAtS ? "done" : "notDone", task.id);
    }

    // Завершено за период: вовремя / поздно / заранее / скорость.
    if (doneAtS && completion && inPeriod(completion.at)) {
      push("completed", task.id);
      if (completion.dueAt !== null) {
        if (completion.at <= completion.dueAt) push("onTime", task.id);
        else push("late", task.id);
        if (completion.at < completion.dueAt) {
          push("early", task.id);
          for (const b of targets) b.earlyLeads.push(completion.dueAt - completion.at);
        }
      }
      const from = actor.settings.speedFrom === "assigned" ? assignedAt : started;
      if (from !== null && from <= completion.at) {
        push("speedIds", task.id);
        for (const b of targets) b.speeds.push(completion.at - from);
      }
    }
  }

  // 3. Сотрудники: участники доступных филиалов + все, кто встречается в выборке.
  const members = await db
    .select({ userId: schema.users.id, name: schema.users.displayName, role: schema.memberships.role, branchId: schema.memberships.branchId })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.companyId, actor.company.id), isNull(schema.memberships.revokedAt)));
  const names = new Map<string, string>();
  const extraIds = [...perUser.keys()].filter((id) => !members.some((m) => m.userId === id));
  if (extraIds.length) {
    const extra = await db.select({ id: schema.users.id, name: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, extraIds));
    for (const u of extra) names.set(u.id, u.name);
  }
  for (const m of members) names.set(m.userId, m.name);
  const visibleMembers = members.filter((m) => m.role !== "director" && m.branchId && branchIds.includes(m.branchId)).map((m) => m.userId);
  const userIds = new Set([...visibleMembers, ...perUser.keys()]);
  if (query.assignee) for (const id of [...userIds]) if (id !== query.assignee) userIds.delete(id);

  const employees = [...userIds]
    .filter(Boolean)
    .map((id) => ({ userId: id, name: names.get(id) ?? "—", ...summarize(perUser.get(id) ?? emptyBucket()) }))
    .sort((a, b) => b.overdue.n - a.overdue.n || b.open.n - a.open.n || a.name.localeCompare(b.name, "ru"));

  // 4. Сведения о задачах для перехода от показателя к исходным задачам.
  const referenced = new Set<string>();
  const metricKeys = Object.keys(summarize(emptyBucket())) as (keyof ReturnType<typeof summarize>)[];
  const collect = (s: ReturnType<typeof summarize>) => {
    for (const key of metricKeys) {
      const v = s[key];
      for (const id of v.ids) referenced.add(id);
      if ("denomIds" in v) for (const id of v.denomIds) referenced.add(id);
    }
  };
  const summary = summarize(total);
  collect(summary);
  for (const e of employees) collect(e);
  const taskMap: Record<string, { number: number; title: string; assignee: string; status: string; dueAt: number | null; branch: string | null }> = {};
  for (const task of tasks) {
    if (!referenced.has(task.id)) continue;
    const info = taskInfo.get(task.id)!;
    taskMap[task.id] = {
      number: task.number,
      title: task.title,
      assignee: names.get(info.assigneeId) ?? "—",
      status: wf.byKey.get(info.statusKey)?.name ?? info.statusKey,
      dueAt: info.dueAt,
      branch: actor.branches.find((b) => b.id === task.branchId)?.name ?? null,
    };
  }

  return {
    period: { from: query.from, to: query.to, startAt, endAt },
    snapshotAt: S,
    snapshot: query.snapshot ?? "now",
    timezone: tz,
    today: dateInZone(now, tz),
    branch: query.branch && query.branch !== "all" ? (actor.branches.find((b) => b.id === query.branch)?.name ?? null) : null,
    assignee: query.assignee ? { id: query.assignee, name: names.get(query.assignee) ?? "—" } : null,
    speedFrom: actor.settings.speedFrom,
    summary,
    employees,
    tasks: taskMap,
  };
}
