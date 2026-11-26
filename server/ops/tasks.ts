/**
 * Задачи: создание, карточка, история, список, фильтры, статусы, приёмка, комментарии, вложения.
 * Используется сайтом, а позже — помощником, WhatsApp и плагином директора.
 *
 * Права: сначала проверяется доступ к записи (иначе «не найдено»), затем право на действие.
 * Изменения защищены номером версии (version) и идентификатором операции (opId).
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { companyConfig } from "../../config/company";
import type { Actor } from "../context";
import { newId } from "../crypto";
import { getDb, schema } from "../db";
import { getEnv } from "../env";
import { AppError, forbidden, notFound } from "../errors";
import { isDirector, isManager, resolveBranch, resolveBranchScope } from "../permissions";
import { dateInZone, dueMomentInZone, timeInZone } from "../time";
import { afterTaskChange, notifyTask } from "../notify/queue";
import { actorRoles, allowedTransitions, loadWorkflow, type Transition, type Workflow } from "../workflow";

type TaskRow = typeof schema.tasks.$inferSelect;
type EventInsert = typeof schema.taskEvents.$inferInsert;

export const CANCELLED_FILTER = "_cancelled";

// ---------- Доступ ----------

/** Видит ли участник задачу. Сотрудник — только свои (исполнитель/постановщик) в своём филиале. */
export function canView(actor: Actor, task: Pick<TaskRow, "companyId" | "branchId" | "assigneeId" | "creatorId">): boolean {
  if (task.companyId !== actor.company.id) return false;
  if (!actor.branches.some((b) => b.id === task.branchId)) return false;
  if (isDirector(actor) || isManager(actor)) return true;
  if (task.assigneeId === actor.user.id) return true;
  if (task.creatorId === actor.user.id && companyConfig.rules.creatorKeepsAccess) return true;
  return actor.settings.employeeSeesColleagues && task.branchId === actor.membership.branchId;
}

/** Может ли менять поля задачи (название, срок, исполнителя и т. д.). */
export function canEdit(actor: Actor, task: Pick<TaskRow, "branchId" | "creatorId" | "isPersonal" | "assigneeId">): boolean {
  if (isDirector(actor) && actor.branches.some((b) => b.id === task.branchId)) return true;
  if (isManager(actor) && actor.membership.branchId === task.branchId) return true;
  if (task.creatorId === actor.user.id && (task.isPersonal || companyConfig.rules.creatorKeepsAccess)) return true;
  return false;
}

async function loadTask(actor: Actor, taskId: string): Promise<TaskRow> {
  const task = await getDb().query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task || !canView(actor, task)) throw notFound("task_not_found");
  return task;
}

/** Кому участник может назначить задачу в филиале. */
export async function assignableUsers(actor: Actor, branchId: string) {
  // «Все филиалы» — только для фильтра списка у директора.
  const branchIds = branchId === "all" && isDirector(actor) ? actor.branches.map((b) => b.id) : [resolveBranch(actor, branchId)];
  const self = { userId: actor.user.id, displayName: actor.user.displayName, role: actor.membership.role, self: true };
  if (!isDirector(actor) && !isManager(actor)) return [self];
  if (branchIds.length === 0) return [self];
  const rows = await getDb()
    .select({ userId: schema.users.id, displayName: schema.users.displayName, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.companyId, actor.company.id),
        inArray(schema.memberships.branchId, branchIds),
        isNull(schema.memberships.revokedAt),
        isNull(schema.users.disabledAt),
        isManager(actor) ? eq(schema.memberships.role, "employee") : inArray(schema.memberships.role, ["employee", "manager"]),
      ),
    )
    .orderBy(asc(schema.users.displayName));
  return [self, ...rows.filter((r) => r.userId !== actor.user.id).map((r) => ({ ...r, self: false }))];
}

async function assertAssignable(actor: Actor, branchId: string, assigneeId: string) {
  const list = await assignableUsers(actor, branchId);
  if (!list.some((u) => u.userId === assigneeId)) throw new AppError("assignee_forbidden", 403, { fields: { assigneeId: "assignee_forbidden" } });
}

// ---------- Идемпотентность ----------

/**
 * Повтор нажатия или доставки с тем же opId не создаёт второго события:
 * возвращается результат первой операции.
 */
async function runOnce<T extends object>(
  actor: Actor,
  opId: string | undefined,
  kind: string,
  fn: () => Promise<T>,
): Promise<T & { replayed?: boolean }> {
  if (!opId) return (await fn()) as T & { replayed?: boolean };
  const db = getDb();
  const read = () => db.query.operations.findFirst({ where: eq(schema.operations.opId, opId) });
  const replay = (row: NonNullable<Awaited<ReturnType<typeof read>>>) => {
    if (row.userId !== actor.user.id || row.kind !== kind) throw new AppError("op_conflict", 409);
    if (!row.resultJson) throw new AppError("op_in_progress", 409);
    return { ...(JSON.parse(row.resultJson) as T), replayed: true };
  };
  const existing = await read();
  if (existing) return replay(existing);
  try {
    await db.insert(schema.operations).values({ opId, userId: actor.user.id, kind, createdAt: Date.now() });
  } catch {
    const row = await read();
    if (row) return replay(row);
    throw new AppError("internal", 500);
  }
  try {
    const result = await fn();
    await db.update(schema.operations).set({ resultJson: JSON.stringify(result) }).where(eq(schema.operations.opId, opId));
    return result as T & { replayed?: boolean };
  } catch (error) {
    await db.delete(schema.operations).where(eq(schema.operations.opId, opId));
    throw error;
  }
}

// ---------- Вспомогательное ----------

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date_invalid");
const opIdSchema = z.string().min(8).max(80).optional();
const checklistSchema = z
  .array(z.object({ id: z.string().min(1).max(40), text: z.string().trim().min(1).max(300), done: z.boolean() }))
  .max(100);

function searchTextOf(t: { number: number; title: string; description?: string | null; resultCriteria?: string | null }) {
  return `#${t.number} ${t.title} ${t.description ?? ""} ${t.resultCriteria ?? ""}`.toLocaleLowerCase("ru");
}

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time_invalid");

/** Момент срока: дата + время задачи или время по умолчанию из настроек компании (23:59). */
function dueAtOf(actor: Actor, dueDate: string | null | undefined, dueTime: string | null | undefined): number | null {
  if (!dueDate) return null;
  try {
    return dueMomentInZone(dueDate, dueTime || actor.settings.dueTime, actor.company.timezone);
  } catch {
    throw new AppError("validation", 400, { fields: { dueDate: "date_invalid" } });
  }
}

function event(task: TaskRow, actor: Actor, e: Partial<EventInsert> & { type: string }, opId?: string): EventInsert {
  return {
    id: newId(),
    taskId: task.id,
    companyId: task.companyId,
    branchId: task.branchId,
    actorId: actor.user.id,
    assigneeId: task.assigneeId,
    dueAt: task.dueAt,
    statusKey: task.statusKey,
    channel: actor.channel,
    opId: opId ?? null,
    createdAt: Date.now(),
    ...e,
  };
}

function conflict(): AppError {
  return new AppError("version_conflict", 409);
}

/** Условное обновление по версии. Нет строки — задачу уже изменили. */
async function updateVersioned(task: TaskRow, version: number, patch: Partial<TaskRow>): Promise<TaskRow> {
  if (task.version !== version) throw conflict();
  const rows = await getDb()
    .update(schema.tasks)
    .set({ ...patch, version: sql`${schema.tasks.version} + 1`, updatedAt: Date.now() })
    .where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.version, version)))
    .returning();
  if (rows.length !== 1) throw conflict();
  return rows[0]!;
}

async function insertEvents(events: EventInsert[]) {
  if (events.length === 0) return;
  const db = getDb();
  const [first, ...rest] = events.map((e) => db.insert(schema.taskEvents).values(e));
  await db.batch([first!, ...rest]);
}

// ---------- Создание ----------

export const createTaskSchema = z.object({
  opId: opIdSchema,
  branchId: z.string().min(1).optional().nullable(),
  title: z.string().trim().min(1, "required").max(300, "too_long"),
  assigneeId: z.string().min(1).optional().nullable(),
  dueDate: dateSchema.optional().nullable(),
  dueTime: timeSchema.optional().nullable(),
  description: z.string().trim().max(10_000, "too_long").optional().nullable(),
  resultCriteria: z.string().trim().max(5_000, "too_long").optional().nullable(),
  checklist: checklistSchema.optional(),
  requiresResult: z.boolean().optional(),
  requiresAttachment: z.boolean().optional(),
});

export async function createTask(actor: Actor, input: z.infer<typeof createTaskSchema>) {
  const branchId = resolveBranch(actor, input.branchId);
  const assigneeId = input.assigneeId || actor.user.id;
  await assertAssignable(actor, branchId, assigneeId);
  const wf = await loadWorkflow(actor.company.id);

  return runOnce(actor, input.opId, "task.create", async () => {
    const db = getDb();
    const now = Date.now();
    const dueAt = dueAtOf(actor, input.dueDate, input.dueTime);
    for (let attempt = 0; attempt < 5; attempt++) {
      const [{ max } = { max: 0 }] = await db
        .select({ max: sql<number>`coalesce(max(${schema.tasks.number}), 0)` })
        .from(schema.tasks)
        .where(eq(schema.tasks.companyId, actor.company.id));
      const number = Number(max) + 1;
      const row: TaskRow = {
        id: newId(),
        companyId: actor.company.id,
        branchId,
        number,
        title: input.title,
        description: input.description || null,
        resultCriteria: input.resultCriteria || null,
        statusKey: wf.initial,
        assigneeId,
        creatorId: actor.user.id,
        isPersonal: assigneeId === actor.user.id,
        dueDate: input.dueDate || null,
        dueTime: input.dueDate ? input.dueTime || null : null,
        dueAt,
        requiresResult: input.requiresResult ?? companyConfig.rules.defaultRequiresResult,
        requiresAttachment: input.requiresAttachment ?? companyConfig.rules.defaultRequiresAttachment,
        checklistJson: JSON.stringify(input.checklist ?? []),
        extraJson: "{}",
        version: 1,
        assignedAt: now,
        startedAt: null,
        submittedAt: null,
        completedAt: null,
        cancelledAt: null,
        reopenCount: 0,
        searchText: "",
        createdAt: now,
        updatedAt: now,
      };
      row.searchText = searchTextOf(row);
      try {
        await db.batch([
          db.insert(schema.tasks).values(row),
          db.insert(schema.taskEvents).values(event(row, actor, { type: "created", newValue: row.title }, input.opId)),
          db.insert(schema.taskEvents).values(
            event(row, actor, { type: "assigned", field: "assigneeId", oldValue: null, newValue: assigneeId }, input.opId),
          ),
        ]);
        await notifyTask(actor, row.id, "assigned", input.opId ?? row.id);
        await afterTaskChange(row.id);
        return { taskId: row.id };
      } catch (error) {
        const msg = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";
        if (!msg.includes("UNIQUE") || attempt === 4) throw error;
      }
    }
    throw new AppError("internal", 500);
  });
}

// ---------- Изменение полей ----------

export const updateTaskSchema = z.object({
  opId: opIdSchema,
  version: z.number().int().positive(),
  title: z.string().trim().min(1, "required").max(300, "too_long").optional(),
  description: z.string().trim().max(10_000, "too_long").nullable().optional(),
  resultCriteria: z.string().trim().max(5_000, "too_long").nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  dueTime: timeSchema.nullable().optional(),
  assigneeId: z.string().min(1).optional(),
  checklist: checklistSchema.optional(),
  requiresResult: z.boolean().optional(),
  requiresAttachment: z.boolean().optional(),
});

export async function updateTask(actor: Actor, taskId: string, input: z.infer<typeof updateTaskSchema>) {
  const task = await loadTask(actor, taskId);
  return runOnce(actor, input.opId, "task.update", async () => {
    const editor = canEdit(actor, task);
    const onlyChecklist = Object.keys(input).every((k) => ["opId", "version", "checklist"].includes(k));
    if (!editor && !onlyChecklist) throw forbidden();
    if (task.cancelledAt && !onlyChecklist) throw new AppError("task_cancelled", 409);

    const patch: Partial<TaskRow> = {};
    const events: Array<Partial<EventInsert> & { type: string }> = [];
    const field = (name: keyof TaskRow, type: string, oldValue: unknown, newValue: unknown) => {
      if ((oldValue ?? null) === (newValue ?? null)) return;
      events.push({ type, field: name, oldValue: oldValue == null ? null : String(oldValue), newValue: newValue == null ? null : String(newValue) });
    };

    if (input.title !== undefined && input.title !== task.title) {
      patch.title = input.title;
      field("title", "field_changed", task.title, input.title);
    }
    if (input.description !== undefined && (input.description || null) !== task.description) {
      patch.description = input.description || null;
      field("description", "field_changed", task.description ? "…" : null, patch.description ? "…" : null);
    }
    if (input.resultCriteria !== undefined && (input.resultCriteria || null) !== task.resultCriteria) {
      patch.resultCriteria = input.resultCriteria || null;
      field("resultCriteria", "field_changed", task.resultCriteria ? "…" : null, patch.resultCriteria ? "…" : null);
    }
    if (input.dueDate !== undefined || input.dueTime !== undefined) {
      const nextDate = input.dueDate !== undefined ? input.dueDate || null : task.dueDate;
      const nextTime = nextDate ? (input.dueTime !== undefined ? input.dueTime || null : task.dueTime) : null;
      const nextAt = dueAtOf(actor, nextDate, nextTime);
      if (nextAt !== task.dueAt || nextDate !== task.dueDate || nextTime !== task.dueTime) {
        patch.dueDate = nextDate;
        patch.dueTime = nextTime;
        patch.dueAt = nextAt;
        const label = (d: string | null, at: number | null) => (d && at ? `${d} ${timeInZone(at, actor.company.timezone)}` : null);
        field("dueAt", "due_changed", label(task.dueDate, task.dueAt), label(nextDate, nextAt));
      }
    }
    if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) {
      await assertAssignable(actor, task.branchId, input.assigneeId);
      patch.assigneeId = input.assigneeId;
      patch.assignedAt = Date.now();
      patch.isPersonal = input.assigneeId === task.creatorId;
      field("assigneeId", "assigned", task.assigneeId, input.assigneeId);
    }
    if (input.requiresResult !== undefined && input.requiresResult !== task.requiresResult) {
      patch.requiresResult = input.requiresResult;
      field("requiresResult", "field_changed", task.requiresResult, input.requiresResult);
    }
    if (input.requiresAttachment !== undefined && input.requiresAttachment !== task.requiresAttachment) {
      patch.requiresAttachment = input.requiresAttachment;
      field("requiresAttachment", "field_changed", task.requiresAttachment, input.requiresAttachment);
    }
    if (input.checklist !== undefined) {
      const before = JSON.parse(task.checklistJson) as z.infer<typeof checklistSchema>;
      if (!editor) {
        // Исполнитель отмечает пункты, но не меняет их состав.
        const same =
          before.length === input.checklist.length &&
          before.every((b, i) => b.id === input.checklist![i]!.id && b.text === input.checklist![i]!.text);
        if (!same || !(actorRoles(actor, task).has("assignee") || actorRoles(actor, task).has("creator"))) throw forbidden();
      }
      const next = JSON.stringify(input.checklist);
      if (next !== task.checklistJson) {
        patch.checklistJson = next;
        const doneBefore = before.filter((i) => i.done).length;
        const doneAfter = input.checklist.filter((i) => i.done).length;
        field("checklistJson", "checklist_changed", `${doneBefore}/${before.length}`, `${doneAfter}/${input.checklist.length}`);
      }
    }

    if (Object.keys(patch).length === 0) {
      if (task.version !== input.version) throw conflict();
      return { taskId: task.id };
    }
    const merged = { ...task, ...patch };
    patch.searchText = searchTextOf(merged);
    const updated = await updateVersioned(task, input.version, patch);
    await insertEvents(events.map((e) => event(updated, actor, e, input.opId)));
    if (patch.assigneeId) await notifyTask(actor, task.id, "assigned", `${updated.version}`);
    if (patch.assigneeId || patch.dueAt !== undefined) await afterTaskChange(task.id);
    return { taskId: task.id };
  });
}

// ---------- Статусы и приёмка ----------

export const changeStatusSchema = z.object({
  opId: opIdSchema,
  version: z.number().int().positive(),
  to: z.string().min(1).max(40),
  comment: z.string().trim().max(10_000, "too_long").optional().nullable(),
  result: z.string().trim().max(10_000, "too_long").optional().nullable(),
});

function eventTypeFor(wf: Workflow, from: string, to: string): string {
  const fromCat = wf.byKey.get(from)?.category;
  const toCat = wf.byKey.get(to)?.category;
  if (fromCat === "review" && toCat === "done") return "accepted";
  if (fromCat === "review" && toCat !== "done") return "returned";
  if (fromCat === "done") return "reopened";
  if (toCat === "review") return "submitted";
  return "status_changed";
}

export async function changeStatus(actor: Actor, taskId: string, input: z.infer<typeof changeStatusSchema>) {
  const task = await loadTask(actor, taskId);
  return runOnce(actor, input.opId, "task.status", async () => {
    if (task.version !== input.version) throw conflict();
    if (task.cancelledAt) throw new AppError("task_cancelled", 409);
    const wf = await loadWorkflow(actor.company.id);
    const transition = allowedTransitions(actor, task, wf).find((t) => t.to === input.to);
    if (!transition) throw new AppError("transition_forbidden", 403);

    const comment = input.comment?.trim() || null;
    const result = input.result?.trim() || null;
    if (transition.requires.comment && !comment) {
      throw new AppError("comment_required", 400, { fields: { comment: "comment_required" } });
    }
    if (transition.requires.result) {
      if (task.requiresResult && !result) throw new AppError("result_required", 400, { fields: { result: "result_required" } });
      if (task.requiresAttachment || transition.requires.attachment) {
        const [{ n } = { n: 0 }] = await getDb()
          .select({ n: sql<number>`count(*)` })
          .from(schema.attachments)
          .where(and(eq(schema.attachments.taskId, task.id), isNull(schema.attachments.deletedAt)));
        if (Number(n) === 0) throw new AppError("attachment_required", 400);
      }
    }

    const now = Date.now();
    const toCat = wf.byKey.get(transition.to)!.category;
    const fromCat = wf.byKey.get(task.statusKey)?.category;
    const patch: Partial<TaskRow> = { statusKey: transition.to };
    if (toCat === "progress" && !task.startedAt) patch.startedAt = now;
    if (toCat === "review") patch.submittedAt = now;
    if (toCat === "done") patch.completedAt = now;
    if (fromCat === "done" && toCat !== "done") {
      patch.completedAt = null;
      patch.reopenCount = task.reopenCount + 1;
    }
    if (toCat === "open") patch.submittedAt = null;

    const updated = await updateVersioned(task, input.version, patch);
    const type = eventTypeFor(wf, task.statusKey, transition.to);
    const db = getDb();
    const writes = [
      db.insert(schema.taskEvents).values(
        event(updated, actor, { type, field: "statusKey", oldValue: task.statusKey, newValue: transition.to, comment }, input.opId),
      ),
    ];
    if (result) {
      writes.push(
        db.insert(schema.taskComments).values({
          id: newId(),
          taskId: task.id,
          authorId: actor.user.id,
          kind: "result",
          body: result,
          opId: input.opId ?? null,
          createdAt: now,
        }) as never,
      );
    }
    if (comment) {
      writes.push(
        db.insert(schema.taskComments).values({
          id: newId(),
          taskId: task.id,
          authorId: actor.user.id,
          kind: type === "returned" ? "return" : "comment",
          body: comment,
          opId: input.opId ?? null,
          createdAt: now,
        }) as never,
      );
    }
    await db.batch(writes as [typeof writes[number], ...typeof writes]);
    if (type === "submitted" || type === "returned" || type === "accepted") {
      await notifyTask(actor, task.id, type, `${updated.version}`, type === "returned" ? comment : result);
    }
    await afterTaskChange(task.id);
    return { taskId: task.id };
  });
}

export const cancelSchema = z.object({
  opId: opIdSchema,
  version: z.number().int().positive(),
  comment: z.string().trim().max(2000).optional().nullable(),
});

/** Отмена и восстановление задачи (учитываются в статистике). */
export async function setCancelled(actor: Actor, taskId: string, cancelled: boolean, input: z.infer<typeof cancelSchema>) {
  const task = await loadTask(actor, taskId);
  return runOnce(actor, input.opId, cancelled ? "task.cancel" : "task.restore", async () => {
    if (!canEdit(actor, task)) throw forbidden();
    if (Boolean(task.cancelledAt) === cancelled) {
      if (task.version !== input.version) throw conflict();
      return { taskId: task.id };
    }
    const updated = await updateVersioned(task, input.version, { cancelledAt: cancelled ? Date.now() : null });
    await insertEvents([event(updated, actor, { type: cancelled ? "cancelled" : "restored", comment: input.comment || null }, input.opId)]);
    await afterTaskChange(task.id);
    return { taskId: task.id };
  });
}

// ---------- Комментарии ----------

export const commentSchema = z.object({ opId: opIdSchema, body: z.string().trim().min(1, "required").max(10_000, "too_long") });

export async function addComment(actor: Actor, taskId: string, input: z.infer<typeof commentSchema>) {
  const task = await loadTask(actor, taskId);
  return runOnce(actor, input.opId, "task.comment", async () => {
    const id = newId();
    await getDb().insert(schema.taskComments).values({
      id,
      taskId: task.id,
      authorId: actor.user.id,
      kind: "comment",
      body: input.body,
      opId: input.opId ?? null,
      createdAt: Date.now(),
    });
    await notifyTask(actor, task.id, "comment", id, input.body);
    return { taskId: task.id, commentId: id };
  });
}

// ---------- Вложения (R2) ----------

function bucket(): R2Bucket {
  const b = getEnv().BUCKET;
  if (!b) throw new AppError("files_unavailable", 503);
  return b;
}

const SAFE_INLINE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function uploadAttachment(actor: Actor, taskId: string, file: File, kind: string) {
  const task = await loadTask(actor, taskId);
  if (task.cancelledAt) throw new AppError("task_cancelled", 409);
  if (file.size <= 0) throw new AppError("file_empty", 400);
  if (file.size > companyConfig.files.maxSize) throw new AppError("file_too_large", 413, { maxSize: companyConfig.files.maxSize });
  const id = newId();
  const key = `${task.companyId}/${task.id}/${id}`;
  const contentType = (file.type || "application/octet-stream").slice(0, 100);
  await bucket().put(key, await file.arrayBuffer(), { httpMetadata: { contentType } });
  const fileName = (file.name || "file").replaceAll(/[\r\n"\\/]/g, "_").slice(0, 200);
  try {
    await getDb().batch([
      getDb().insert(schema.attachments).values({
        id,
        companyId: task.companyId,
        branchId: task.branchId,
        taskId: task.id,
        uploaderId: actor.user.id,
        objectKey: key,
        fileName,
        contentType,
        size: file.size,
        kind: ["photo", "result", "file"].includes(kind) ? kind : contentType.startsWith("image/") ? "photo" : "file",
        createdAt: Date.now(),
      }),
      getDb().insert(schema.taskEvents).values(event(task, actor, { type: "attachment", newValue: fileName })),
    ]);
  } catch (error) {
    await bucket().delete(key).catch(() => {});
    throw error;
  }
  return { id, fileName, contentType, size: file.size };
}

async function loadAttachment(actor: Actor, attachmentId: string) {
  const att = await getDb().query.attachments.findFirst({ where: eq(schema.attachments.id, attachmentId) });
  if (!att || att.deletedAt || !att.taskId) throw notFound();
  const task = await loadTask(actor, att.taskId).catch(() => null);
  if (!task) throw notFound();
  return { att, task };
}

/** Скачивание: права проверяются по задаче — прямая ссылка на чужой файл даёт 404. */
export async function downloadAttachment(actor: Actor, attachmentId: string): Promise<Response> {
  const { att } = await loadAttachment(actor, attachmentId);
  const object = await bucket().get(att.objectKey);
  if (!object) throw notFound("file_missing");
  const inline = SAFE_INLINE.has(att.contentType);
  const encoded = encodeURIComponent(att.fileName);
  return new Response(object.body, {
    headers: {
      "content-type": inline ? att.contentType : "application/octet-stream",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

export async function deleteAttachment(actor: Actor, attachmentId: string) {
  const { att, task } = await loadAttachment(actor, attachmentId);
  if (att.uploaderId !== actor.user.id && !canEdit(actor, task)) throw forbidden();
  const wf = await loadWorkflow(actor.company.id);
  if (wf.byKey.get(task.statusKey)?.category === "done") throw new AppError("task_done_locked", 409);
  await getDb().update(schema.attachments).set({ deletedAt: Date.now() }).where(eq(schema.attachments.id, att.id));
  await bucket().delete(att.objectKey).catch(() => {});
  await insertEvents([event(task, actor, { type: "attachment_deleted", oldValue: att.fileName })]);
  return { ok: true };
}

// ---------- Карточка ----------

function primaryTransition(actor: Actor, task: TaskRow, list: Transition[], wf: Workflow): Transition | null {
  if (list.length === 0) return null;
  const roles = actorRoles(actor, task);
  const cat = (t: Transition) => wf.byKey.get(t.to)?.category;
  const order = roles.has("assignee") ? ["progress", "review", "done"] : ["done", "progress", "review"];
  for (const c of order) {
    // «Вернуть на доработку» — не основное действие.
    const hit = list.find((t) => cat(t) === c && !(wf.byKey.get(t.from)?.category === "review" && c === "progress"));
    if (hit) return hit;
  }
  return null;
}

export async function getTaskCard(actor: Actor, taskId: string) {
  const task = await loadTask(actor, taskId);
  const db = getDb();
  const wf = await loadWorkflow(actor.company.id);
  const [events, comments, files] = await Promise.all([
    db.select().from(schema.taskEvents).where(eq(schema.taskEvents.taskId, task.id)).orderBy(desc(schema.taskEvents.createdAt)).limit(300),
    db.select().from(schema.taskComments).where(eq(schema.taskComments.taskId, task.id)).orderBy(asc(schema.taskComments.createdAt)).limit(500),
    db
      .select()
      .from(schema.attachments)
      .where(and(eq(schema.attachments.taskId, task.id), isNull(schema.attachments.deletedAt)))
      .orderBy(asc(schema.attachments.createdAt)),
  ]);

  const userIds = new Set<string>([task.assigneeId, task.creatorId]);
  for (const e of events) {
    if (e.actorId) userIds.add(e.actorId);
    if (e.field === "assigneeId") {
      if (e.oldValue) userIds.add(e.oldValue);
      if (e.newValue) userIds.add(e.newValue);
    }
  }
  for (const c of comments) userIds.add(c.authorId);
  for (const f of files) userIds.add(f.uploaderId);
  const people = await db
    .select({ id: schema.users.id, displayName: schema.users.displayName })
    .from(schema.users)
    .where(inArray(schema.users.id, [...userIds]));
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id)?.displayName ?? "—") : null);
  const statusName = (key: string | null) => (key ? (wf.byKey.get(key)?.name ?? key) : null);

  const transitions = allowedTransitions(actor, task, wf);
  const primary = primaryTransition(actor, task, transitions, wf);
  const now = Date.now();
  const status = wf.byKey.get(task.statusKey);
  const done = status?.category === "done";

  return {
    task: {
      id: task.id,
      number: task.number,
      branchId: task.branchId,
      branchName: actor.branches.find((b) => b.id === task.branchId)?.name ?? null,
      title: task.title,
      description: task.description,
      resultCriteria: task.resultCriteria,
      status: { key: task.statusKey, name: status?.name ?? task.statusKey, category: status?.category ?? "open" },
      assignee: { id: task.assigneeId, displayName: name(task.assigneeId) },
      creator: { id: task.creatorId, displayName: name(task.creatorId) },
      isPersonal: task.isPersonal,
      dueDate: task.dueDate,
      dueTime: task.dueDate ? (task.dueTime ?? actor.settings.dueTime) : null,
      dueAt: task.dueAt,
      overdue: Boolean(task.dueAt && task.dueAt < now && !done && !task.cancelledAt),
      checklist: JSON.parse(task.checklistJson) as z.infer<typeof checklistSchema>,
      requiresResult: task.requiresResult,
      requiresAttachment: task.requiresAttachment,
      version: task.version,
      startedAt: task.startedAt,
      submittedAt: task.submittedAt,
      completedAt: task.completedAt,
      cancelledAt: task.cancelledAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
    permissions: {
      edit: canEdit(actor, task) && !task.cancelledAt,
      cancel: canEdit(actor, task),
      checklist: canEdit(actor, task) || actorRoles(actor, task).has("assignee"),
      comment: true,
      attach: !task.cancelledAt,
    },
    transitions: transitions.map((t) => ({
      to: t.to,
      toName: statusName(t.to),
      kind: eventTypeFor(wf, t.from, t.to),
      requires: {
        comment: Boolean(t.requires.comment),
        result: Boolean(t.requires.result),
        resultText: Boolean(t.requires.result) && task.requiresResult,
        attachment: Boolean(t.requires.result) && (task.requiresAttachment || Boolean(t.requires.attachment)),
      },
    })),
    primary: primary?.to ?? null,
    comments: comments.map((c) => ({ id: c.id, kind: c.kind, body: c.body, author: name(c.authorId), createdAt: c.createdAt })),
    attachments: files.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      contentType: f.contentType,
      size: f.size,
      kind: f.kind,
      uploader: name(f.uploaderId),
      canDelete: !done && (f.uploaderId === actor.user.id || canEdit(actor, task)),
      createdAt: f.createdAt,
    })),
    history: events.map((e) => {
      const label = (v: string | null) => {
        if (v == null) return null;
        if (e.field === "assigneeId") return name(v);
        if (e.field === "statusKey") return statusName(v);
        return v;
      };
      return {
        id: e.id,
        type: e.type,
        field: e.field,
        oldValue: label(e.oldValue),
        newValue: label(e.newValue),
        comment: e.comment,
        actor: name(e.actorId),
        channel: e.channel,
        createdAt: e.createdAt,
      };
    }),
  };
}

// ---------- Список (общий запрос для списка и канбана) ----------

export const listQuerySchema = z.object({
  branch: z.string().optional().nullable(),
  view: z.enum(["mine", "all"]).optional().nullable(),
  q: z.string().trim().max(200).optional().nullable(),
  status: z.array(z.string().max(40)).max(20).optional(),
  assignee: z.string().max(80).optional().nullable(),
  due: z.enum(["overdue", "today", "week", "none", "has"]).optional().nullable(),
  limit: z.number().int().min(1).max(500).optional(),
});

export function parseListQuery(url: URL) {
  const p = url.searchParams;
  return listQuerySchema.parse({
    branch: p.get("branch"),
    view: p.get("view") || null,
    q: p.get("q"),
    status: p.getAll("status").filter(Boolean),
    assignee: p.get("assignee"),
    due: p.get("due") || null,
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
  });
}

/** Различаются ли «Мои задачи» и «Все доступные» для участника. */
export function viewsDiffer(actor: Actor): boolean {
  return isDirector(actor) || isManager(actor) || actor.settings.employeeSeesColleagues;
}

export async function listTasks(actor: Actor, query: z.infer<typeof listQuerySchema>) {
  const db = getDb();
  const wf = await loadWorkflow(actor.company.id);
  // Список и изменения — в конкретном филиале; «все филиалы» только для директора.
  const allBranches = query.branch === "all" || (!query.branch && isDirector(actor));
  const branchIds = allBranches ? resolveBranchScope(actor, "all") : [resolveBranch(actor, query.branch)];
  if (branchIds.length === 0) throw new AppError("no_branches", 409);
  const now = Date.now();
  const tz = actor.company.timezone;
  const today = dateInZone(now, tz);
  const doneKeys = wf.statuses.filter((s) => s.category === "done").map((s) => s.key);
  const differ = viewsDiffer(actor);
  const view = differ ? (query.view ?? (isDirector(actor) || isManager(actor) ? "all" : "mine")) : "mine";

  // Базовые условия: права участника (сначала права, потом фильтры).
  const base: SQL[] = [eq(schema.tasks.companyId, actor.company.id), inArray(schema.tasks.branchId, branchIds)];
  if (!isDirector(actor) && !isManager(actor) && !actor.settings.employeeSeesColleagues) {
    const own = [eq(schema.tasks.assigneeId, actor.user.id)];
    if (companyConfig.rules.creatorKeepsAccess) own.push(eq(schema.tasks.creatorId, actor.user.id));
    base.push(or(...own)!);
  }
  if (view === "mine") base.push(eq(schema.tasks.assigneeId, actor.user.id));
  if (query.q) {
    const lower = query.q.toLocaleLowerCase("ru").replace(/^#/, "");
    const needle = lower.replaceAll(/[\\%_]/g, (m) => `\\${m}`);
    const byText = sql`${schema.tasks.searchText} LIKE ${`%${needle}%`} ESCAPE '\\'`;
    // Имя исполнителя: SQLite не сравнивает кириллицу без учёта регистра — сопоставление в JS.
    const people = await db
      .select({ id: schema.users.id, name: schema.users.displayName })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.companyId, actor.company.id));
    const ids = [...new Set(people.filter((p) => p.name.toLocaleLowerCase("ru").includes(lower)).map((p) => p.id))];
    base.push(ids.length ? or(byText, inArray(schema.tasks.assigneeId, ids))! : byText);
  }
  if (query.assignee) base.push(eq(schema.tasks.assigneeId, query.assignee === "me" ? actor.user.id : query.assignee));
  const notDone = doneKeys.length ? notInArray(schema.tasks.statusKey, doneKeys) : sql`1 = 1`;
  if (query.due === "overdue") base.push(and(isNotNull(schema.tasks.dueAt), lt(schema.tasks.dueAt, now), notDone)!);
  if (query.due === "today") base.push(eq(schema.tasks.dueDate, today));
  if (query.due === "week") {
    const weekEnd = dateInZone(now + 6 * 86400_000, tz);
    base.push(sql`${schema.tasks.dueDate} BETWEEN ${today} AND ${weekEnd}`);
  }
  if (query.due === "none") base.push(isNull(schema.tasks.dueAt));
  if (query.due === "has") base.push(isNotNull(schema.tasks.dueAt));

  const wantCancelled = query.status?.includes(CANCELLED_FILTER) ?? false;
  const statusKeys = (query.status ?? []).filter((s) => s !== CANCELLED_FILTER);
  const cancelCond = wantCancelled ? isNotNull(schema.tasks.cancelledAt) : isNull(schema.tasks.cancelledAt);
  const withStatus = [...base, cancelCond];
  if (statusKeys.length) withStatus.push(inArray(schema.tasks.statusKey, statusKeys));

  const limit = query.limit ?? 300;
  const rows = await db
    .select({
      id: schema.tasks.id,
      number: schema.tasks.number,
      branchId: schema.tasks.branchId,
      title: schema.tasks.title,
      statusKey: schema.tasks.statusKey,
      assigneeId: schema.tasks.assigneeId,
      assigneeName: schema.users.displayName,
      creatorId: schema.tasks.creatorId,
      dueDate: schema.tasks.dueDate,
      dueAt: schema.tasks.dueAt,
      version: schema.tasks.version,
      isPersonal: schema.tasks.isPersonal,
      cancelledAt: schema.tasks.cancelledAt,
      checklistJson: schema.tasks.checklistJson,
      updatedAt: schema.tasks.updatedAt,
    })
    .from(schema.tasks)
    .innerJoin(schema.users, eq(schema.users.id, schema.tasks.assigneeId))
    .where(and(...withStatus))
    .orderBy(sql`${schema.tasks.dueAt} IS NULL`, asc(schema.tasks.dueAt), desc(schema.tasks.updatedAt))
    .limit(limit + 1);

  // Счётчики — тот же запрос без фильтра статуса (одинаковы для списка и канбана).
  const counts = await db
    .select({ statusKey: schema.tasks.statusKey, n: sql<number>`count(*)` })
    .from(schema.tasks)
    .where(and(...base, isNull(schema.tasks.cancelledAt)))
    .groupBy(schema.tasks.statusKey);
  const [overdue] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.tasks)
    .where(and(...base, isNull(schema.tasks.cancelledAt), isNotNull(schema.tasks.dueAt), lt(schema.tasks.dueAt, now), notDone));
  const [cancelled] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.tasks)
    .where(and(...base, isNotNull(schema.tasks.cancelledAt)));

  const items = rows.slice(0, limit).map((r) => {
    const checklist = JSON.parse(r.checklistJson) as { done: boolean }[];
    const status = wf.byKey.get(r.statusKey);
    return {
      id: r.id,
      number: r.number,
      branchId: r.branchId,
      title: r.title,
      status: { key: r.statusKey, name: status?.name ?? r.statusKey, category: status?.category ?? "open" },
      assignee: { id: r.assigneeId, displayName: r.assigneeName, self: r.assigneeId === actor.user.id },
      branchName: actor.branches.find((b) => b.id === r.branchId)?.name ?? null,
      dueDate: r.dueDate,
      dueAt: r.dueAt,
      overdue: Boolean(r.dueAt && r.dueAt < now && status?.category !== "done" && !r.cancelledAt),
      isPersonal: r.isPersonal,
      cancelled: Boolean(r.cancelledAt),
      checklist: { total: checklist.length, done: checklist.filter((c) => c.done).length },
      version: r.version,
      /** Куда участник может перенести задачу (подсветка колонок канбана). */
      moves: allowedTransitions(actor, r, wf).map((t) => ({
        to: t.to,
        needsForm: Boolean(t.requires.comment || t.requires.result),
      })),
    };
  });

  return {
    items,
    hasMore: rows.length > limit,
    view,
    viewsDiffer: differ,
    counts: {
      byStatus: Object.fromEntries(wf.statuses.map((s) => [s.key, Number(counts.find((c) => c.statusKey === s.key)?.n ?? 0)])),
      overdue: Number(overdue?.n ?? 0),
      cancelled: Number(cancelled?.n ?? 0),
      total: counts.reduce((a, c) => a + Number(c.n), 0),
    },
    statuses: wf.statuses.map((s) => ({ key: s.key, name: s.name, category: s.category })),
    cancelledName: actor.settings.cancelledName,
    allBranches,
    timezone: tz,
    today,
    snapshotAt: now,
  };
}

// ---------- Для плагина директора (без UI): поиск исполнителей ----------

export async function searchAssignees(actor: Actor, branchId: string, q: string) {
  const list = await assignableUsers(actor, branchId);
  const needle = q.trim().toLocaleLowerCase("ru");
  return needle ? list.filter((u) => u.displayName.toLocaleLowerCase("ru").includes(needle)) : list;
}

