/**
 * Разбор сообщения помощнику. Порядок:
 * 1) ожидающее подтверждение или выбор карточки (детерминированно, без модели);
 * 2) явные команды («мои задачи», «сдать #12: …», «создай …»);
 * 3) если директор указал ключ OpenAI — модель GPT с теми же действиями; иначе — подсказка по командам.
 * Удаление и массовые изменения выполняются только после «да».
 */
import type { Actor } from "../context";
import { AppError } from "../errors";
import { errorMessage } from "./errors";
import * as act from "./actions";
import { parseDate, parseRelative, todayIn, wordRegExp as w } from "./dates";
import { runModel } from "./llm";
import { getSecret } from "../integrations";
import { dueMomentInZone } from "../time";

type Action =
  | { type: "show" }
  | { type: "start" }
  | { type: "submit"; result: string }
  | { type: "due"; date: string | null; time: string | null }
  | { type: "description"; text: string }
  | { type: "remind"; at?: number; beforeMinutes?: number }
  | { type: "cancel" };

export type Pending =
  | { kind: "choose"; action: Action; candidates: { id: string; number: number; title: string }[] }
  | { kind: "confirm"; op: { type: "cancel"; taskId: string } | { type: "bulkDue"; ids: string[]; date: string; time: string | null }; summary: string };

export type AssistantState = { pending?: Pending };
export type AssistantReply = act.Result & { state: AssistantState; mode: "commands" | "model" };

/** Умный режим доступен, когда директор указал ключ OpenAI в настройках. */
export async function modelAvailable(): Promise<boolean> {
  return Boolean(await getSecret("openai"));
}

export const HELP = [
  "Я работаю с вашими задачами. Примеры:",
  "• «мои задачи», «просроченные»",
  "• «создай купить муку завтра в 10:00»",
  "• «начать #12», «сдать #12: отчёт отправлен»",
  "• «срок #12 пятница 18:00», «описание #12 …»",
  "• «напомни #12 через 2 часа» или «за 1 час»",
  "• «перенеси все просроченные на понедельник», «отмени #12» — после подтверждения",
].join("\n");

const YES = w("^\\s*(да|ага|подтверждаю|подтвердить|верно|ок|okay|yes|давай)\\b");
const NO = w("^\\s*(нет|отмена|не надо|стоп|no)\\b");

function taskNumber(text: string): number | null {
  const m = /(?:#|№|\bзадач[аиуе]?\s+)(\d{1,7})/iu.exec(text);
  return m ? Number(m[1]) : null;
}

/** Текст без служебных частей (команды, даты). Номер задачи сохраняется — по нему ищется задача. */
function strip(text: string, ...parts: (string | undefined | null)[]): string {
  let out = text;
  for (const p of parts) if (p) out = out.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu"), " ");
  return out.replace(/\s+/g, " ").replace(/^[\s:—-]+|[\s:—-]+$/g, "").trim();
}

/** Текст без номера задачи («#12», «№12») — для описания и результата. */
function withoutRef(text: string): string {
  return strip(text.replace(/(?:#|№)\d+/g, " "));
}

async function resolve(actor: Actor, text: string, action: Action, state: AssistantState): Promise<AssistantReply | act.TaskBrief> {
  const number = taskNumber(text);
  const found = await act.findTasks(actor, number ? { number } : { text });
  if (found.length === 1) return found[0]!;
  if (found.length === 0) {
    return {
      text: number ? `Задача #${number} не найдена среди ваших задач.` : "Не нашёл такую задачу среди ваших открытых. Укажите номер: «#12».",
      links: [],
      state,
      mode: "commands",
    };
  }
  const candidates = found.slice(0, 8).map((t) => ({ id: t.id, number: t.number, title: t.title }));
  return {
    text: ["Нашёл несколько задач — выберите номер:", ...candidates.map((c, i) => `${i + 1}. #${c.number} ${c.title}`)].join("\n"),
    links: candidates.map((c) => ({ taskId: c.id, number: c.number, title: c.title })),
    state: { pending: { kind: "choose", action, candidates } },
    mode: "commands",
  };
}

async function perform(actor: Actor, task: act.TaskBrief, action: Action): Promise<AssistantReply> {
  const done = (r: act.Result, state: AssistantState = {}): AssistantReply => ({ ...r, state, mode: "commands" });
  switch (action.type) {
    case "show":
      return done(await act.showTask(actor, task));
    case "start":
      return done(await act.moveTask(actor, task, "start"));
    case "submit":
      return done(await act.moveTask(actor, task, "submit", action.result));
    case "description":
      return done(await act.updateFields(actor, task, { description: action.text }));
    case "due":
      return done(await act.updateFields(actor, task, { dueDate: action.date, dueTime: action.date ? action.time : null }));
    case "remind":
      return done(await act.remind(actor, task, action));
    case "cancel":
      return done(
        { text: `Отменить задачу #${task.number} «${task.title}»? Ответьте «да» или «нет».`, links: [act.link(task)] },
        { pending: { kind: "confirm", op: { type: "cancel", taskId: task.id }, summary: `отмена #${task.number}` } },
      );
  }
}

/** Команды без модели. null — команда не распознана. */
async function commands(actor: Actor, raw: string, state: AssistantState): Promise<AssistantReply | null> {
  const text = raw.trim();
  const t = text.toLowerCase().replaceAll("ё", "е");
  const tz = actor.company.timezone;
  const today = todayIn(tz);
  const reply = (r: act.Result, next: AssistantState = {}): AssistantReply => ({ ...r, state: next, mode: "commands" });

  if (w("^(помощь|help|\\?|команды|что (ты )?умеешь)").test(t)) return reply({ text: HELP, links: [] });

  // Массовый перенос срока — только после подтверждения.
  if (w("\\b(перенеси|перенести|сдвинь)\\s+(все|всех)\\b").test(t)) {
    const date = parseDate(t, today);
    if (!date) return reply({ text: "Укажите новый срок: «перенеси все просроченные на понедельник».", links: [] });
    const onlyOverdue = w("\\bпросроч").test(t);
    const tasks = (await act.myTasks(actor)).filter((x) => !onlyOverdue || x.overdue);
    if (!tasks.length) return reply({ text: "Подходящих задач нет.", links: [] });
    const when = dueMomentInZone(date.date, date.time ?? actor.settings.dueTime, tz);
    const summary = `перенос срока ${tasks.length} задач`;
    return reply(
      {
        text: `Перенести срок у ${tasks.length} задач (${tasks.slice(0, 10).map((x) => `#${x.number}`).join(", ")}${tasks.length > 10 ? "…" : ""}) на ${new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(when))}? Ответьте «да» или «нет».`,
        links: [],
      },
      { pending: { kind: "confirm", op: { type: "bulkDue", ids: tasks.map((x) => x.id), date: date.date, time: date.time }, summary } },
    );
  }

  if (w("^(мои задачи|задачи|список|что у меня|покажи задачи|мои дела)\\b").test(t) || w("\\bпросроч").test(t)) {
    const overdueOnly = w("\\bпросроч").test(t);
    const tasks = (await act.myTasks(actor)).filter((x) => !overdueOnly || x.overdue);
    if (!tasks.length) return reply({ text: overdueOnly ? "Просроченных задач нет." : "Открытых задач нет. Создать: «создай …».", links: [] });
    return reply({ text: tasks.slice(0, 20).map((x) => act.line(x, tz)).join("\n") + (tasks.length > 20 ? `\n…и ещё ${tasks.length - 20}` : ""), links: tasks.slice(0, 5).map(act.link) });
  }

  let m: RegExpExecArray | null;
  if ((m = w("^(создай|создать|добавь|новая задача|запиши|поставь себе|напиши себе)\\s*(задачу)?\\s*[:—-]?\\s*").exec(t)) && text.length > m[0].length) {
    const rest = text.slice(m[0].length);
    const date = parseDate(rest, today);
    const timeOnly = /\s*в\s*\d{1,2}[:.]\d{2}/u;
    const title = strip(rest, date?.match, date?.time ? timeOnly.exec(rest)?.[0] : null).replace(/\s+(до|к|на|в)$/u, "");
    if (!title) return reply({ text: "Как назвать задачу? Например: «создай позвонить поставщику завтра».", links: [] });
    return reply(await act.createPersonal(actor, { title: title.charAt(0).toUpperCase() + title.slice(1), dueDate: date?.date ?? null, dueTime: date?.time ?? null }));
  }

  if ((m = w("^(начни|начать|в работу|беру|приступаю|старт)\\b").exec(t))) {
    const r = await resolve(actor, strip(text, m[0]), { type: "start" }, state);
    return "id" in r ? perform(actor, r, { type: "start" }) : r;
  }

  if ((m = w("^(сдай|сдать|готово|выполнил[а]?|выполнено|сделал[а]?|сделано|сдаю)\\b").exec(t))) {
    const rest = text.slice(m[0].length);
    const colon = rest.indexOf(":");
    const result = colon >= 0 ? rest.slice(colon + 1).trim() : "";
    const target = colon >= 0 ? rest.slice(0, colon) : rest;
    const action: Action = { type: "submit", result: result || (taskNumber(target) ? withoutRef(target) : "") };
    const r = await resolve(actor, target, action, state);
    return "id" in r ? perform(actor, r, action) : r;
  }

  if ((m = w("^(описание|опиши)\\b").exec(t))) {
    const rest = text.slice(m[0].length);
    const num = taskNumber(rest);
    const body = withoutRef(rest);
    if (!num || !body) return reply({ text: "Формат: «описание #12 текст».", links: [] });
    const action: Action = { type: "description", text: body };
    const r = await resolve(actor, `#${num}`, action, state);
    return "id" in r ? perform(actor, r, action) : r;
  }

  if ((m = w("^(срок|перенеси|перенести|сдвинь|измени срок)\\b").exec(t))) {
    const rest = text.slice(m[0].length);
    const date = parseDate(rest, today);
    const remove = w("\\b(без срока|убери срок|удали срок)\\b").test(t);
    if (!date && !remove) return reply({ text: "Укажите новый срок: «срок #12 пятница 18:00».", links: [] });
    const action: Action = { type: "due", date: remove ? null : date!.date, time: remove ? null : date!.time };
    const r = await resolve(actor, strip(rest, date?.match), action, state);
    return "id" in r ? perform(actor, r, action) : r;
  }

  if ((m = w("^(напомни|напоминание|напомнить)\\b").exec(t))) {
    const rest = text.slice(m[0].length);
    const rel = parseRelative(rest);
    const date = parseDate(rest, today);
    let action: Action | null = null;
    if (rel?.inMinutes) action = { type: "remind", at: Date.now() + rel.inMinutes * 60_000 };
    else if (rel?.beforeMinutes) action = { type: "remind", beforeMinutes: rel.beforeMinutes };
    else if (date) action = { type: "remind", at: dueMomentInZone(date.date, date.time ?? "09:00", tz) - 59_999 };
    if (!action) return reply({ text: "Когда напомнить? «напомни #12 завтра в 10:00», «через 2 часа» или «за 1 час».", links: [] });
    const target = strip(rest, date?.match).replace(w("\\b(о|об|про|через|за)\\b.*$"), "");
    const r = await resolve(actor, taskNumber(rest) ? `#${taskNumber(rest)}` : target, action, state);
    return "id" in r ? perform(actor, r, action) : r;
  }

  if ((m = w("^(отмени|отменить|удали|удалить)\\b").exec(t))) {
    const r = await resolve(actor, strip(text, m[0]), { type: "cancel" }, state);
    return "id" in r ? perform(actor, r, { type: "cancel" }) : r;
  }

  const number = taskNumber(text);
  if (number && text.replace(/(?:#|№|задач[аиуе]?\s*)\d+/iu, "").trim().length < 3) {
    const r = await resolve(actor, text, { type: "show" }, state);
    return "id" in r ? perform(actor, r, { type: "show" }) : r;
  }
  return null;
}

async function confirm(actor: Actor, pending: Extract<Pending, { kind: "confirm" }>): Promise<act.Result> {
  if (pending.op.type === "cancel") {
    const all = await act.myTasks(actor);
    const task = all.find((x) => x.id === (pending.op as { taskId: string }).taskId);
    if (!task) return { text: "Задача уже недоступна.", links: [] };
    return act.cancelTask(actor, task);
  }
  return act.bulkDue(actor, pending.op.ids, pending.op.date, pending.op.time);
}

export async function handleMessage(actor: Actor, text: string, state: AssistantState, history: { role: "user" | "assistant"; content: string }[]): Promise<AssistantReply> {
  try {
    const pending = state.pending;
    if (pending?.kind === "confirm") {
      if (YES.test(text)) return { ...(await confirm(actor, pending)), state: {}, mode: "commands" };
      if (NO.test(text)) return { text: "Хорошо, ничего не меняю.", links: [], state: {}, mode: "commands" };
    }
    if (pending?.kind === "choose") {
      const n = /^\s*(\d{1,2})\s*$/.exec(text);
      const num = taskNumber(text);
      const pick = n ? pending.candidates[Number(n[1]) - 1] : num ? pending.candidates.find((c) => c.number === num) : undefined;
      if (pick) {
        const task = (await act.findTasks(actor, { number: pick.number }))[0];
        if (task) return perform(actor, task, pending.action);
      }
    }
    const byCommand = await commands(actor, text, {});
    if (byCommand) return byCommand;
    if (await modelAvailable()) {
      const r = await runModel(actor, text, history);
      return { ...r.result, state: r.pending ? { pending: r.pending } : {}, mode: "model" };
    }
    return { text: `Не понял. ${HELP}`, links: [], state: {}, mode: "commands" };
  } catch (error) {
    if (error instanceof AppError) return { text: errorMessage(error.code), links: [], state: {}, mode: "commands" };
    console.error("[assistant] failed", error instanceof Error ? error.stack ?? error.message : error);
    return { text: "Не получилось выполнить. Попробуйте ещё раз или откройте карточку задачи.", links: [], state: {}, mode: "commands" };
  }
}
