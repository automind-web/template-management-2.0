/**
 * Действия помощника. Общие для команд, модели GPT, веб-чата и WhatsApp:
 * внутри вызываются те же серверные операции, что и на сайте, с теми же проверками прав.
 * Помощник работает только с задачами, где участник — исполнитель; у директора — только с его личными задачами.
 */
import type { Actor } from "../context";
import { AppError } from "../errors";
import { formatShortDateTime } from "../../lib/format";
import { scheduleReminder } from "../notify/queue";
import { isDirector } from "../permissions";
import { dueMomentInZone } from "../time";
import { changeStatus, createTask, getTaskCard, listTasks, setCancelled, updateTask } from "../ops/tasks";
import { newId } from "../crypto";

export type TaskBrief = {
  id: string;
  number: number;
  title: string;
  status: string;
  category: string;
  dueAt: number | null;
  overdue: boolean;
  version: number;
};
export type Link = { taskId: string; number: number; title: string };
export type Result = { text: string; links: Link[] };

/** Задачи, доступные помощнику участника. */
export async function myTasks(actor: Actor, opts: { includeDone?: boolean } = {}): Promise<TaskBrief[]> {
  const list = await listTasks(actor, { branch: isDirector(actor) ? "all" : null, view: "mine", limit: 300 });
  return list.items
    .filter((i) => !isDirector(actor) || i.isPersonal)
    .filter((i) => opts.includeDone || i.status.category !== "done")
    .map((i) => ({
      id: i.id,
      number: i.number,
      title: i.title,
      status: i.status.name,
      category: i.status.category,
      dueAt: i.dueAt,
      overdue: i.overdue,
      version: i.version,
    }));
}

export function line(t: TaskBrief, tz: string): string {
  return `#${t.number} ${t.title} — ${t.status}, ${t.dueAt ? formatShortDateTime(t.dueAt, tz) : "без срока"}${t.overdue ? " (просрочена)" : ""}`;
}

export const link = (t: { id: string; number: number; title: string }): Link => ({ taskId: t.id, number: t.number, title: t.title });

/** Поиск своей задачи по номеру или словам названия. */
export async function findTasks(actor: Actor, query: { number?: number | null; text?: string | null }): Promise<TaskBrief[]> {
  const all = await myTasks(actor, { includeDone: Boolean(query.number) });
  if (query.number) return all.filter((t) => t.number === query.number);
  const words = (query.text ?? "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .split(/[^\p{L}\d]+/u)
    .filter((w) => w.length > 2);
  if (!words.length) return [];
  const norm = (s: string) => s.toLowerCase().replaceAll("ё", "е");
  // Совпадение по основе слова (первые 5 букв) — «отчёт», «отчёта», «отчёты».
  return all.filter((t) => words.every((w) => norm(t.title).includes(w.slice(0, Math.max(4, Math.min(5, w.length))))));
}

/** Личная задача: исполнитель — сам участник; филиал — свой (у директора — первый доступный). */
export async function createPersonal(actor: Actor, input: { title: string; dueDate?: string | null; dueTime?: string | null; description?: string | null }): Promise<Result> {
  const branchId = actor.membership.branchId ?? actor.branches[0]?.id;
  if (!branchId) throw new AppError("no_branches", 409);
  const r = await createTask(actor, {
    opId: newId(),
    branchId,
    title: input.title.slice(0, 300),
    assigneeId: actor.user.id,
    dueDate: input.dueDate ?? null,
    dueTime: input.dueDate ? (input.dueTime ?? null) : null,
    description: input.description ?? null,
  });
  const card = await getTaskCard(actor, r.taskId);
  const due = card.task.dueAt ? `, срок ${formatShortDateTime(card.task.dueAt, actor.company.timezone)}` : ", без срока";
  return { text: `Создал личную задачу #${card.task.number} «${card.task.title}»${due}.`, links: [link({ id: card.task.id, number: card.task.number, title: card.task.title })] };
}

export async function showTask(actor: Actor, t: TaskBrief): Promise<Result> {
  const card = await getTaskCard(actor, t.id);
  const parts = [line(t, actor.company.timezone)];
  if (card.task.description) parts.push(card.task.description.slice(0, 500));
  const next = card.transitions.find((tr) => tr.to === card.primary);
  if (next) parts.push(`Следующее действие: ${next.kind === "submitted" ? "сдать результат" : next.kind === "accepted" ? "принять" : `перевести в «${next.toName}»`}.`);
  return { text: parts.join("\n"), links: [link(t)] };
}

/** Перевод статуса: «начать работу» или «сдать результат» — только если переход разрешён. */
export async function moveTask(actor: Actor, t: TaskBrief, action: "start" | "submit", result?: string | null): Promise<Result> {
  const card = await getTaskCard(actor, t.id);
  const target =
    action === "start"
      ? card.transitions.find((tr) => tr.kind === "status_changed" && card.task.status.category === "open")
      : card.transitions.find((tr) => tr.requires.result || tr.kind === "submitted");
  if (!target) {
    return { text: `По задаче #${t.number} сейчас это действие недоступно (статус «${card.task.status.name}»).`, links: [link(t)] };
  }
  if (target.requires.resultText && !result?.trim()) {
    return { text: `Чтобы сдать #${t.number}, опишите результат: «сдать #${t.number}: что сделано».`, links: [link(t)] };
  }
  if (target.requires.attachment && card.attachments.length === 0) {
    return { text: `Для сдачи #${t.number} нужно вложение — приложите файл или фото в карточке задачи.`, links: [link(t)] };
  }
  const next = await changeStatus(actor, t.id, { opId: newId(), version: card.task.version, to: target.to, result: result?.trim() || null });
  const fresh = await getTaskCard(actor, next.taskId);
  return { text: `Готово: #${t.number} теперь «${fresh.task.status.name}».`, links: [link(t)] };
}

export async function updateFields(
  actor: Actor,
  t: TaskBrief,
  patch: { title?: string; description?: string; dueDate?: string | null; dueTime?: string | null },
): Promise<Result> {
  const card = await getTaskCard(actor, t.id);
  if (!card.permissions.edit) return { text: `Менять задачу #${t.number} может постановщик или руководитель.`, links: [link(t)] };
  await updateTask(actor, t.id, { opId: newId(), version: card.task.version, ...patch });
  const fresh = await getTaskCard(actor, t.id);
  const due = fresh.task.dueAt ? formatShortDateTime(fresh.task.dueAt, actor.company.timezone) : "без срока";
  return { text: `Обновил #${t.number}: «${fresh.task.title}», срок ${due}.`, links: [link(t)] };
}

export async function remind(actor: Actor, t: TaskBrief, when: { at?: number; beforeMinutes?: number }): Promise<Result> {
  let at = when.at;
  if (when.beforeMinutes !== undefined) {
    if (!t.dueAt) return { text: `У задачи #${t.number} нет срока — скажите, когда напомнить: «напомни #${t.number} завтра в 10:00».`, links: [link(t)] };
    at = t.dueAt - when.beforeMinutes * 60_000;
  }
  if (!at || at <= Date.now()) return { text: "Это время уже прошло. Укажите момент в будущем.", links: [link(t)] };
  await scheduleReminder(actor, t.id, at);
  return { text: `Напомню о #${t.number} ${formatShortDateTime(at, actor.company.timezone)}.`, links: [link(t)] };
}

export async function cancelTask(actor: Actor, t: TaskBrief): Promise<Result> {
  const card = await getTaskCard(actor, t.id);
  if (!card.permissions.cancel) return { text: `Отменить задачу #${t.number} может постановщик или руководитель.`, links: [link(t)] };
  await setCancelled(actor, t.id, true, { opId: newId(), version: card.task.version });
  return { text: `Задача #${t.number} отменена. Её можно восстановить в карточке.`, links: [link(t)] };
}

export async function bulkDue(actor: Actor, ids: string[], date: string, time: string | null): Promise<Result> {
  const tasks = (await myTasks(actor)).filter((t) => ids.includes(t.id));
  const done: TaskBrief[] = [];
  for (const t of tasks) {
    const card = await getTaskCard(actor, t.id);
    if (!card.permissions.edit) continue;
    await updateTask(actor, t.id, { opId: newId(), version: card.task.version, dueDate: date, dueTime: time });
    done.push(t);
  }
  const when = formatShortDateTime(dueMomentInZone(date, time ?? actor.settings.dueTime, actor.company.timezone), actor.company.timezone);
  const skipped = tasks.length - done.length;
  return {
    text: `Перенёс срок на ${when}: ${done.map((t) => `#${t.number}`).join(", ") || "—"}.${skipped ? ` Без прав на изменение: ${skipped}.` : ""}`,
    links: done.slice(0, 10).map(link),
  };
}
