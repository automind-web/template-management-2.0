/**
 * Уведомления: очередь доставки в БД (notification_deliveries).
 * Долгих фоновых процессов нет: очередь обрабатывается короткими порциями после запросов
 * (ctx.waitUntil, не чаще раза в 15 с), при открытии «Уведомлений» и в scheduled(), если Sites
 * запускает Worker по расписанию. Каналы: кабинет (всегда), WhatsApp, push устройства.
 */
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Actor } from "../context";
import { loadActorForUser } from "../context";
import { newId } from "../crypto";
import { getDb, schema } from "../db";
import { getEnv } from "../env";
import { formatShortDateTime } from "../../lib/format";
import { tzOffsetMs } from "../time";
import { sendWhatsAppText, whapiConfigured } from "../whatsapp/whapi";
import { canView } from "../ops/tasks";
import { loadWorkflow } from "../workflow";
import { loadPrefs, type NotifyEvent, type Prefs } from "./prefs";
import { sendWebPush } from "./webpush";

type TaskRow = typeof schema.tasks.$inferSelect;
type Channel = "cabinet" | "whatsapp" | "push";

const REMINDER_EVENTS: NotifyEvent[] = ["dueSoon", "overdue"];

function text(event: NotifyEvent, task: TaskRow, tz: string, extra?: string | null): { title: string; body: string } {
  const name = `«${task.title}»`;
  switch (event) {
    case "assigned":
      return { title: `Вам назначена задача: ${name}`, body: task.dueAt ? `Срок: ${formatShortDateTime(task.dueAt, tz)}` : "Без срока" };
    case "dueSoon":
      return { title: `Скоро срок: ${name}`, body: task.dueAt ? `До ${formatShortDateTime(task.dueAt, tz)}` : "" };
    case "overdue":
      return { title: `Срок прошёл: ${name}`, body: task.dueAt ? `Срок был ${formatShortDateTime(task.dueAt, tz)}` : "" };
    case "submitted":
      return { title: `Задачу сдали на проверку: ${name}`, body: extra ?? "" };
    case "returned":
      return { title: `Задачу вернули на доработку: ${name}`, body: extra ?? "" };
    case "accepted":
      return { title: `Результат принят: ${name}`, body: "" };
    case "comment":
      return { title: `Новый комментарий: ${name}`, body: (extra ?? "").slice(0, 300) };
  }
}

async function channelsFor(userId: string, prefs: Prefs): Promise<Channel[]> {
  const channels: Channel[] = ["cabinet"];
  if (prefs.channels.whatsapp) {
    const user = await getDb().query.users.findFirst({ where: eq(schema.users.id, userId) });
    if (user?.phoneVerifiedAt) channels.push("whatsapp");
  }
  if (prefs.channels.push) channels.push("push");
  return channels;
}

async function enqueue(params: {
  companyId: string;
  userId: string;
  task: TaskRow;
  event: NotifyEvent;
  scheduledAt: number;
  key: string;
  extra?: string | null;
  tz: string;
}) {
  const prefs = await loadPrefs(params.userId);
  if (!prefs.events[params.event]) return;
  const { title, body } = text(params.event, params.task, params.tz, params.extra);
  const now = Date.now();
  const db = getDb();
  for (const channel of await channelsFor(params.userId, prefs)) {
    // Событие «сейчас» в кабинете доставляется сразу; остальное — через очередь.
    const immediate = channel === "cabinet" && params.scheduledAt <= now && !REMINDER_EVENTS.includes(params.event);
    await db
      .insert(schema.notificationDeliveries)
      .values({
        id: newId(),
        companyId: params.companyId,
        userId: params.userId,
        taskId: params.task.id,
        channel,
        event: params.event,
        dedupeKey: `${params.key}:${params.userId}:${channel}`,
        title,
        body,
        url: `/tasks/${params.task.id}`,
        scheduledAt: params.scheduledAt,
        status: immediate ? "sent" : "pending",
        sentAt: immediate ? now : null,
        createdAt: now,
      })
      // Повтор события не создаёт второй доставки; отменённое напоминание с тем же сроком возвращается в очередь.
      .onConflictDoUpdate({
        target: schema.notificationDeliveries.dedupeKey,
        set: { status: "pending", scheduledAt: params.scheduledAt, attempts: 0, error: null, title, body },
        setWhere: sql`${schema.notificationDeliveries.status} = 'cancelled'`,
      });
  }
}

/** Пересчёт напоминаний задачи: после переноса срока, смены исполнителя, завершения, отмены. */
export async function rescheduleReminders(taskId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.notificationDeliveries)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.notificationDeliveries.taskId, taskId),
        inArray(schema.notificationDeliveries.event, REMINDER_EVENTS),
        eq(schema.notificationDeliveries.status, "pending"),
      ),
    );
  const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
  if (!task || task.cancelledAt || task.dueAt === null) return;
  const wf = await loadWorkflow(task.companyId);
  if (wf.byKey.get(task.statusKey)?.category === "done") return;
  const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, task.companyId) });
  const tz = company?.timezone ?? "UTC";
  const prefs = await loadPrefs(task.assigneeId);
  const now = Date.now();
  for (const minutes of prefs.remindBefore) {
    const at = task.dueAt - minutes * 60_000;
    if (at > now) {
      await enqueue({ companyId: task.companyId, userId: task.assigneeId, task, event: "dueSoon", scheduledAt: at, key: `due:${task.id}:${task.dueAt}:${minutes}`, tz });
    }
  }
  if (task.dueAt > now - 60_000) {
    await enqueue({ companyId: task.companyId, userId: task.assigneeId, task, event: "overdue", scheduledAt: task.dueAt + 1, key: `overdue:${task.id}:${task.dueAt}`, tz });
  }
}

/**
 * Уведомления по действию с задачей. Получатели — кроме автора действия.
 * Ошибки уведомлений не отменяют само действие.
 */
export async function notifyTask(
  actor: Actor,
  taskId: string,
  event: Exclude<NotifyEvent, "dueSoon" | "overdue">,
  uniq: string,
  extra?: string | null,
): Promise<void> {
  try {
    const db = getDb();
    const task = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, taskId) });
    if (!task) return;
    const recipients = new Set<string>();
    if (event === "assigned" || event === "returned" || event === "accepted") recipients.add(task.assigneeId);
    if (event === "comment") {
      recipients.add(task.assigneeId);
      recipients.add(task.creatorId);
    }
    if (event === "submitted") {
      if (task.creatorId !== task.assigneeId) recipients.add(task.creatorId);
      const managers = await db
        .select({ userId: schema.memberships.userId })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.branchId, task.branchId), eq(schema.memberships.role, "manager"), isNull(schema.memberships.revokedAt)));
      for (const m of managers) recipients.add(m.userId);
    }
    recipients.delete(actor.user.id);
    for (const userId of recipients) {
      await enqueue({ companyId: task.companyId, userId, task, event, scheduledAt: Date.now(), key: `${event}:${task.id}:${uniq}`, extra, tz: actor.company.timezone });
    }
  } catch (error) {
    console.error("[notify] enqueue failed", error instanceof Error ? error.message : error);
  }
}

export async function afterTaskChange(taskId: string): Promise<void> {
  try {
    await rescheduleReminders(taskId);
  } catch (error) {
    console.error("[notify] reschedule failed", error instanceof Error ? error.message : error);
  }
}

// ---------- Доставка ----------

function minutesOf(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
}

/** Ближайший момент, когда можно отправить во внешний канал (тихие часы, пауза, рабочие дни). */
export function nextAllowedAt(at: number, prefs: Prefs, tz: string, workDays: number[]): number {
  let t = Math.max(at, prefs.pausedUntil ?? 0);
  for (let guard = 0; guard < 14 * 24 * 4; guard++) {
    const local = new Date(t + tzOffsetMs(tz, t));
    const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
    const dow = local.getUTCDay() === 0 ? 7 : local.getUTCDay();
    let ok = true;
    if (prefs.workDaysOnly && !workDays.includes(dow)) ok = false;
    if (ok && prefs.quiet.enabled) {
      const from = minutesOf(prefs.quiet.from);
      const to = minutesOf(prefs.quiet.to);
      const inQuiet = from <= to ? minute >= from && minute < to : minute >= from || minute < to;
      if (inQuiet) ok = false;
    }
    if (ok) return t;
    t += 15 * 60_000 - (t % (15 * 60_000)); // шаг 15 минут
  }
  return t;
}

async function siteOrigin(): Promise<string> {
  const row = await getDb().query.settings.findFirst({
    where: and(eq(schema.settings.scope, "company"), eq(schema.settings.scopeId, "system"), eq(schema.settings.key, "origin")),
  });
  return row ? (JSON.parse(row.valueJson) as string) : "";
}

/** Адрес сайта для ссылок в WhatsApp и push (запоминается по запросам к сайту). */
let knownOrigin: string | null = null;
export async function rememberOrigin(origin: string): Promise<void> {
  if (knownOrigin === origin || !/^https?:\/\//.test(origin)) return;
  knownOrigin = origin;
  const now = Date.now();
  await getDb()
    .insert(schema.settings)
    .values({ scope: "company", scopeId: "system", key: "origin", valueJson: JSON.stringify(origin), updatedAt: now })
    .onConflictDoUpdate({ target: [schema.settings.scope, schema.settings.scopeId, schema.settings.key], set: { valueJson: JSON.stringify(origin), updatedAt: now } });
}

type Delivery = typeof schema.notificationDeliveries.$inferSelect;

async function deliver(d: Delivery): Promise<{ status: "sent" | "cancelled" | "retry" | "failed" | "later"; at?: number; error?: string }> {
  const db = getDb();
  const actor = await loadActorForUser(d.userId, "web");
  if (!actor) return { status: "cancelled", error: "no_access" };
  // Права проверяются заново: задача должна быть доступна участнику на момент доставки.
  const task = d.taskId ? await db.query.tasks.findFirst({ where: eq(schema.tasks.id, d.taskId) }) : null;
  if (d.taskId) {
    if (!task || !canView(actor, task)) return { status: "cancelled", error: "no_access" };
  }
  if (task && REMINDER_EVENTS.includes(d.event as NotifyEvent)) {
    const wf = await loadWorkflow(task.companyId);
    const open = !task.cancelledAt && wf.byKey.get(task.statusKey)?.category !== "done";
    if (!open || task.assigneeId !== d.userId || task.dueAt === null) return { status: "cancelled", error: "not_relevant" };
  }
  if (d.channel === "cabinet") return { status: "sent" };

  const prefs = await loadPrefs(d.userId);
  const allowedAt = nextAllowedAt(Date.now(), prefs, actor.company.timezone, actor.settings.workDays);
  if (allowedAt > Date.now() + 1000) return { status: "later", at: allowedAt };
  const origin = await siteOrigin();
  const link = d.url && origin ? `${origin}${d.url}` : "";

  if (d.channel === "whatsapp") {
    if (!prefs.channels.whatsapp) return { status: "cancelled", error: "channel_off" };
    if (!whapiConfigured()) return { status: "failed", error: "whapi_missing" };
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, d.userId) });
    if (!user?.phone || !user.phoneVerifiedAt) return { status: "cancelled", error: "phone_not_linked" };
    const res = await sendWhatsAppText(user.phone, [d.title, d.body, link].filter(Boolean).join("\n"));
    return res.ok ? { status: "sent" } : { status: "retry", error: `whapi_${res.status}` };
  }

  // push
  if (!prefs.channels.push) return { status: "cancelled", error: "channel_off" };
  const env = getEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { status: "failed", error: "vapid_missing" };
  const subs = await db
    .select()
    .from(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, d.userId), isNull(schema.pushSubscriptions.revokedAt)));
  if (subs.length === 0) return { status: "cancelled", error: "no_subscription" };
  let delivered = 0;
  for (const s of subs) {
    try {
      const r = await sendWebPush(
        s,
        { title: d.title, body: d.body, url: d.url, tag: d.id },
        { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: origin || "mailto:noreply@example.com" },
      );
      if (r.ok) delivered++;
      if (r.gone) await db.update(schema.pushSubscriptions).set({ revokedAt: Date.now() }).where(eq(schema.pushSubscriptions.id, s.id));
    } catch {
      /* следующая подписка */
    }
  }
  return delivered ? { status: "sent" } : { status: "retry", error: "push_failed" };
}

/** Обработка порции очереди. userId — только доставки этого участника (при открытии «Уведомлений»). */
export async function processQueue(opts: { userId?: string; limit?: number } = {}): Promise<number> {
  const db = getDb();
  const now = Date.now();
  const due = await db
    .select()
    .from(schema.notificationDeliveries)
    .where(
      and(
        lte(schema.notificationDeliveries.scheduledAt, now),
        or(
          eq(schema.notificationDeliveries.status, "pending"),
          and(eq(schema.notificationDeliveries.status, "sending"), lt(schema.notificationDeliveries.lockedUntil, now)),
        ),
        opts.userId ? eq(schema.notificationDeliveries.userId, opts.userId) : undefined,
      ),
    )
    .orderBy(asc(schema.notificationDeliveries.scheduledAt))
    .limit(opts.limit ?? 25);

  let processed = 0;
  for (const row of due) {
    // Захват строки: параллельный обработчик её не получит.
    const claimed = await db
      .update(schema.notificationDeliveries)
      .set({ status: "sending", lockedUntil: now + 60_000 })
      .where(and(eq(schema.notificationDeliveries.id, row.id), eq(schema.notificationDeliveries.status, row.status)))
      .returning({ id: schema.notificationDeliveries.id });
    if (claimed.length !== 1) continue;
    let result: Awaited<ReturnType<typeof deliver>>;
    try {
      result = await deliver(row);
    } catch (error) {
      result = { status: "retry", error: error instanceof Error ? error.message.slice(0, 200) : "error" };
    }
    const attempts = row.attempts + 1;
    const patch: Partial<Delivery> = { lockedUntil: null, error: result.error ?? null };
    if (result.status === "sent") Object.assign(patch, { status: "sent", sentAt: Date.now() });
    else if (result.status === "later") Object.assign(patch, { status: "pending", scheduledAt: result.at });
    else if (result.status === "retry" && attempts < 5) Object.assign(patch, { status: "pending", attempts, scheduledAt: Date.now() + 2 ** attempts * 60_000 });
    else Object.assign(patch, { status: result.status === "cancelled" ? "cancelled" : "failed", attempts });
    await db.update(schema.notificationDeliveries).set(patch).where(eq(schema.notificationDeliveries.id, row.id));
    processed++;
  }
  return processed;
}

/** Не чаще раза в 15 секунд (для ctx.waitUntil после запросов). */
export async function maybeProcessQueue(): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const key = { scope: "company" as const, scopeId: "system", key: "queue_run" };
  try {
    await db.insert(schema.settings).values({ ...key, valueJson: "0", updatedAt: now }).onConflictDoNothing();
    const claimed = await db
      .update(schema.settings)
      .set({ valueJson: String(now), updatedAt: now })
      .where(
        and(
          eq(schema.settings.scope, key.scope),
          eq(schema.settings.scopeId, key.scopeId),
          eq(schema.settings.key, key.key),
          sql`CAST(${schema.settings.valueJson} AS INTEGER) < ${now - 15_000}`,
        ),
      )
      .returning({ key: schema.settings.key });
    if (claimed.length === 1) await processQueue({ limit: 25 });
  } catch (error) {
    console.error("[notify] queue run failed", error instanceof Error ? error.message : error);
  }
}

// ---------- Входящие ----------

export async function inbox(actor: Actor) {
  await processQueue({ userId: actor.user.id, limit: 20 });
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.notificationDeliveries)
    .where(and(eq(schema.notificationDeliveries.userId, actor.user.id), eq(schema.notificationDeliveries.channel, "cabinet"), eq(schema.notificationDeliveries.status, "sent")))
    .orderBy(desc(schema.notificationDeliveries.sentAt))
    .limit(50);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.notificationDeliveries)
    .where(
      and(
        eq(schema.notificationDeliveries.userId, actor.user.id),
        eq(schema.notificationDeliveries.channel, "cabinet"),
        eq(schema.notificationDeliveries.status, "pending"),
        inArray(schema.notificationDeliveries.event, REMINDER_EVENTS),
      ),
    );
  return {
    items: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, url: r.url, at: r.sentAt ?? r.createdAt, read: Boolean(r.readAt) })),
    unread: rows.filter((r) => !r.readAt).length,
    scheduled: Number(n),
  };
}

export async function unreadCount(actor: Actor): Promise<number> {
  const [{ n } = { n: 0 }] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.notificationDeliveries)
    .where(
      and(
        eq(schema.notificationDeliveries.userId, actor.user.id),
        eq(schema.notificationDeliveries.channel, "cabinet"),
        eq(schema.notificationDeliveries.status, "sent"),
        isNull(schema.notificationDeliveries.readAt),
      ),
    );
  return Number(n);
}

export async function markRead(actor: Actor, ids: string[] | "all") {
  await getDb()
    .update(schema.notificationDeliveries)
    .set({ readAt: Date.now() })
    .where(
      and(
        eq(schema.notificationDeliveries.userId, actor.user.id),
        eq(schema.notificationDeliveries.channel, "cabinet"),
        isNull(schema.notificationDeliveries.readAt),
        ids === "all" ? undefined : inArray(schema.notificationDeliveries.id, ids.length ? ids : ["-"]),
      ),
    );
  return { ok: true };
}

/** Сохранение настроек: напоминания задач участника пересчитываются под новые интервалы. */
export async function afterPrefsChange(actor: Actor): Promise<void> {
  const db = getDb();
  const tasks = await db
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.assigneeId, actor.user.id), isNull(schema.tasks.completedAt), isNull(schema.tasks.cancelledAt)))
    .limit(200);
  // Внешние каналы, которые участник отключил, больше ничего не получают; напоминания строятся заново.
  await db
    .update(schema.notificationDeliveries)
    .set({ status: "cancelled" })
    .where(and(eq(schema.notificationDeliveries.userId, actor.user.id), eq(schema.notificationDeliveries.status, "pending"), inArray(schema.notificationDeliveries.channel, ["whatsapp", "push"])));
  for (const t of tasks) await afterTaskChange(t.id);
}
