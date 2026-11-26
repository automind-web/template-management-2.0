/**
 * Диалоги помощника. Веб-чат и WhatsApp используют одни серверные операции,
 * но истории раздельные (assistant_threads: пользователь + канал); ответ идёт в исходный канал.
 */
import { and, desc, eq } from "drizzle-orm";
import type { Actor } from "../context";
import { newId } from "../crypto";
import { getDb, schema } from "../db";
import { AppError } from "../errors";
import { runOnce } from "../ops/tasks";
import { handleMessage, HELP, modelAvailable, type AssistantState } from "./engine";
import { transcribe } from "./llm";
import { companyConfig } from "../../config/company";

type Channel = "web" | "whatsapp";

async function thread(userId: string, channel: Channel) {
  const db = getDb();
  const now = Date.now();
  await db.insert(schema.assistantThreads).values({ id: newId(), userId, channel, createdAt: now, updatedAt: now }).onConflictDoNothing();
  return (await db.query.assistantThreads.findFirst({
    where: and(eq(schema.assistantThreads.userId, userId), eq(schema.assistantThreads.channel, channel)),
  }))!;
}

function toView(m: typeof schema.assistantMessages.$inferSelect) {
  const meta = JSON.parse(m.metaJson) as { links?: { taskId: string; number: number; title: string }[] };
  return { id: m.id, role: m.role as "user" | "assistant", text: m.content, links: meta.links ?? [], at: m.createdAt };
}

export async function getChat(actor: Actor) {
  const t = await thread(actor.user.id, "web");
  const rows = await getDb()
    .select()
    .from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.threadId, t.id))
    .orderBy(desc(schema.assistantMessages.createdAt))
    .limit(60);
  return {
    name: actor.settings.assistantName,
    mode: (await modelAvailable()) ? "model" : "commands",
    voice: await modelAvailable(),
    help: HELP,
    messages: rows.reverse().filter((m) => m.role === "user" || m.role === "assistant").map(toView),
  };
}

/** Сообщение помощнику из любого канала. Возвращает реплики пользователя и помощника. */
export async function sendMessage(actor: Actor, channel: Channel, text: string, externalId?: string | null) {
  const body = text.trim().slice(0, 4000);
  if (!body) throw new AppError("validation", 400, { fields: { text: "required" } });
  const db = getDb();
  const t = await thread(actor.user.id, channel);
  const history = await db
    .select()
    .from(schema.assistantMessages)
    .where(eq(schema.assistantMessages.threadId, t.id))
    .orderBy(desc(schema.assistantMessages.createdAt))
    .limit(12);
  const now = Date.now();
  const userMsg = { id: newId(), threadId: t.id, role: "user" as const, content: body, metaJson: "{}", externalId: externalId ?? null, createdAt: now };
  await db.insert(schema.assistantMessages).values(userMsg);

  const state = JSON.parse(t.stateJson) as AssistantState;
  const reply = await handleMessage(
    { ...actor, channel },
    body,
    state,
    history.reverse().filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  );
  const botMsg = {
    id: newId(),
    threadId: t.id,
    role: "assistant" as const,
    content: reply.text,
    metaJson: JSON.stringify({ links: reply.links, mode: reply.mode }),
    externalId: null,
    createdAt: Date.now(),
  };
  await db.batch([
    db.insert(schema.assistantMessages).values(botMsg),
    db.update(schema.assistantThreads).set({ stateJson: JSON.stringify(reply.state), updatedAt: Date.now() }).where(eq(schema.assistantThreads.id, t.id)),
  ]);
  return { messages: [toView(userMsg), toView(botMsg)], reply };
}

/** Веб-чат: повторная отправка с тем же opId не выполняет команду второй раз. */
export async function sendWebMessage(actor: Actor, text: string, opId?: string) {
  return runOnce(actor, opId, "assistant.message", async () => ({ messages: (await sendMessage(actor, "web", text)).messages }));
}

const MAX_AUDIO = 10 * 1024 * 1024;

export async function sendVoice(actor: Actor, audio: File, channel: Channel = "web") {
  if (!(await modelAvailable())) throw new AppError("voice_unavailable", 503);
  if (audio.size === 0) throw new AppError("file_empty", 400);
  if (audio.size > MAX_AUDIO) throw new AppError("file_too_large", 413);
  const text = await transcribe(audio, companyConfig.assistant.transcribeModel).catch(() => {
    throw new AppError("voice_failed", 502);
  });
  if (!text) throw new AppError("voice_empty", 422);
  return sendMessage(actor, channel, text);
}

export async function clearChat(actor: Actor) {
  const t = await thread(actor.user.id, "web");
  await getDb().delete(schema.assistantMessages).where(eq(schema.assistantMessages.threadId, t.id));
  await getDb().update(schema.assistantThreads).set({ stateJson: "{}" }).where(eq(schema.assistantThreads.id, t.id));
  return { ok: true };
}

