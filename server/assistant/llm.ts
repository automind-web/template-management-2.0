/**
 * Помощник на модели GPT (OpenAI Chat Completions + tools). Ключ — только из секрета OPENAI_API_KEY.
 * Модель вызывает те же действия, что и команды; права проверяют серверные операции.
 * Отмена задачи и массовые изменения не выполняются моделью: она лишь готовит запрос, а выполнение —
 * только после ответа участника «да» (детерминированно, в engine.ts).
 */
import type { Actor } from "../context";
import { getEnv } from "../env";
import { formatShortDateTime } from "../../lib/format";
import * as act from "./actions";
import type { Pending } from "./engine";
import { todayIn } from "./dates";
import { dueMomentInZone } from "../time";

const API = "https://api.openai.com/v1";

const tools = [
  {
    type: "function",
    function: {
      name: "list_my_tasks",
      description: "Мои задачи (исполнитель — я). filter: open | overdue | all. query — слова для поиска по названию.",
      parameters: {
        type: "object",
        properties: { filter: { type: "string", enum: ["open", "overdue", "all"] }, query: { type: "string" } },
        required: ["filter"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_personal_task",
      description: "Создать личную задачу себе. Дата YYYY-MM-DD и время HH:MM — в часовом поясе компании; без даты — «без срока».",
      parameters: {
        type: "object",
        properties: { title: { type: "string" }, due_date: { type: "string" }, due_time: { type: "string" }, description: { type: "string" } },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description: "Изменить разрешённые поля своей задачи по номеру: название, описание, срок (due_date: null — убрать срок).",
      parameters: {
        type: "object",
        properties: {
          task_number: { type: "integer" },
          title: { type: "string" },
          description: { type: "string" },
          due_date: { type: ["string", "null"] },
          due_time: { type: "string" },
        },
        required: ["task_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "change_status",
      description: "start — начать работу; submit — сдать результат (result — что сделано).",
      parameters: {
        type: "object",
        properties: { task_number: { type: "integer" }, action: { type: "string", enum: ["start", "submit"] }, result: { type: "string" } },
        required: ["task_number", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_reminder",
      description: "Напоминание по задаче: либо at_date/at_time (YYYY-MM-DD, HH:MM), либо minutes_before_due, либо in_minutes.",
      parameters: {
        type: "object",
        properties: {
          task_number: { type: "integer" },
          at_date: { type: "string" },
          at_time: { type: "string" },
          minutes_before_due: { type: "integer" },
          in_minutes: { type: "integer" },
        },
        required: ["task_number"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "request_cancel_task",
      description: "Подготовить отмену задачи. Выполнится только после ответа пользователя «да».",
      parameters: { type: "object", properties: { task_number: { type: "integer" } }, required: ["task_number"] },
    },
  },
  {
    type: "function",
    function: {
      name: "request_bulk_due",
      description: "Подготовить перенос срока нескольких задач. Выполнится только после ответа «да».",
      parameters: {
        type: "object",
        properties: { task_numbers: { type: "array", items: { type: "integer" } }, due_date: { type: "string" }, due_time: { type: "string" } },
        required: ["task_numbers", "due_date"],
      },
    },
  },
] as const;

type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function chat(model: string, messages: Message[]) {
  const res = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${getEnv().OPENAI_API_KEY!.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.2 }),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
  return data.choices[0]!.message;
}

async function byNumber(actor: Actor, n: unknown) {
  const list = await act.findTasks(actor, { number: Number(n) });
  return list[0] ?? null;
}

export async function runModel(
  actor: Actor,
  text: string,
  history: { role: "user" | "assistant"; content: string }[],
): Promise<{ result: act.Result; pending?: Pending }> {
  const tz = actor.company.timezone;
  const links: act.Link[] = [];
  let pending: Pending | undefined;
  const system = [
    `Ты — ${actor.settings.assistantName}, помощник по задачам в рабочем кабинете. Отвечай по-русски, коротко и по делу.`,
    `Пользователь: ${actor.user.displayName}. Сегодня ${todayIn(tz)}, часовой пояс ${tz}.`,
    actor.membership.role === "director" ? "Ты работаешь только с личными задачами директора." : "Ты работаешь только с задачами, где пользователь — исполнитель.",
    "Используй инструменты; не выдумывай задачи и номера. Если подходит несколько задач — перечисли их с номерами и попроси выбрать.",
    "Отмену и массовые изменения только подготавливай (request_*) и проси ответить «да».",
    "После изменения назови номер задачи.",
  ].join("\n");
  const messages: Message[] = [{ role: "system", content: system }, ...history.slice(-12), { role: "user", content: text }];

  for (let step = 0; step < 5; step++) {
    const reply = await chat(actor.settings.assistantModel, messages);
    if (!reply.tool_calls?.length) return { result: { text: reply.content?.trim() || "Готово.", links }, pending };
    messages.push({ role: "assistant", content: reply.content, tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      let output: unknown;
      try {
        output = await execute(actor, call.function.name, JSON.parse(call.function.arguments || "{}"), links, (p) => (pending = p));
      } catch (error) {
        output = { error: error instanceof Error ? error.message : "failed" };
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(output).slice(0, 6000) });
    }
  }
  return { result: { text: "Не удалось завершить запрос. Попробуйте сформулировать короче.", links }, pending };
}

async function execute(actor: Actor, name: string, args: Record<string, unknown>, links: act.Link[], setPending: (p: Pending) => void): Promise<unknown> {
  const tz = actor.company.timezone;
  const done = (r: act.Result) => {
    links.push(...r.links);
    return { ok: true, message: r.text };
  };
  switch (name) {
    case "list_my_tasks": {
      let tasks = await act.myTasks(actor, { includeDone: args.filter === "all" });
      if (args.filter === "overdue") tasks = tasks.filter((t) => t.overdue);
      if (typeof args.query === "string" && args.query.trim()) {
        const found = new Set((await act.findTasks(actor, { text: args.query })).map((t) => t.id));
        tasks = tasks.filter((t) => found.has(t.id));
      }
      return tasks.slice(0, 30).map((t) => ({ number: t.number, title: t.title, status: t.status, due: t.dueAt ? formatShortDateTime(t.dueAt, tz) : null, overdue: t.overdue }));
    }
    case "create_personal_task":
      return done(await act.createPersonal(actor, { title: String(args.title ?? ""), dueDate: (args.due_date as string) || null, dueTime: (args.due_time as string) || null, description: (args.description as string) || null }));
    case "update_task": {
      const task = await byNumber(actor, args.task_number);
      if (!task) return { error: "task_not_found" };
      const patch: Parameters<typeof act.updateFields>[2] = {};
      if (typeof args.title === "string") patch.title = args.title;
      if (typeof args.description === "string") patch.description = args.description;
      if ("due_date" in args) {
        patch.dueDate = (args.due_date as string | null) || null;
        patch.dueTime = patch.dueDate ? (args.due_time as string) || null : null;
      }
      return done(await act.updateFields(actor, task, patch));
    }
    case "change_status": {
      const task = await byNumber(actor, args.task_number);
      if (!task) return { error: "task_not_found" };
      return done(await act.moveTask(actor, task, args.action === "submit" ? "submit" : "start", (args.result as string) ?? null));
    }
    case "set_reminder": {
      const task = await byNumber(actor, args.task_number);
      if (!task) return { error: "task_not_found" };
      if (typeof args.in_minutes === "number") return done(await act.remind(actor, task, { at: Date.now() + args.in_minutes * 60_000 }));
      if (typeof args.minutes_before_due === "number") return done(await act.remind(actor, task, { beforeMinutes: args.minutes_before_due }));
      if (typeof args.at_date === "string") {
        return done(await act.remind(actor, task, { at: dueMomentInZone(args.at_date, (args.at_time as string) || "09:00", tz) - 59_999 }));
      }
      return { error: "time_required" };
    }
    case "request_cancel_task": {
      const task = await byNumber(actor, args.task_number);
      if (!task) return { error: "task_not_found" };
      setPending({ kind: "confirm", op: { type: "cancel", taskId: task.id }, summary: `отмена #${task.number}` });
      links.push(act.link(task));
      return { ok: true, message: `Ожидаю подтверждения пользователя на отмену #${task.number}.` };
    }
    case "request_bulk_due": {
      const numbers = Array.isArray(args.task_numbers) ? (args.task_numbers as number[]) : [];
      const tasks = (await act.myTasks(actor)).filter((t) => numbers.includes(t.number));
      if (!tasks.length) return { error: "task_not_found" };
      setPending({ kind: "confirm", op: { type: "bulkDue", ids: tasks.map((t) => t.id), date: String(args.due_date), time: (args.due_time as string) || null }, summary: `перенос ${tasks.length} задач` });
      return { ok: true, message: `Ожидаю подтверждения переноса ${tasks.length} задач.` };
    }
    default:
      return { error: "unknown_tool" };
  }
}

/** Распознавание голоса (OpenAI). Без ключа — недоступно. */
export async function transcribe(audio: File, model: string): Promise<string> {
  const form = new FormData();
  form.set("file", audio, audio.name || "voice.webm");
  form.set("model", model);
  form.set("language", "ru");
  const res = await fetch(`${API}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${getEnv().OPENAI_API_KEY!.trim()}` },
    body: form,
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}
