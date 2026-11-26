/**
 * Входящие сообщения Whapi (вебхук). Адрес содержит ключ, производный от токена:
 * чужие запросы отклоняются. Непривязанный номер ничего не получает (кроме подтверждения кода привязки).
 * Веб-чат и WhatsApp используют одни серверные операции, истории раздельные, ответ — в WhatsApp.
 */
import { and, eq } from "drizzle-orm";
import { companyConfig } from "../../config/company";
import { sendMessage } from "../assistant/service";
import { transcribe } from "../assistant/llm";
import { modelAvailable } from "../assistant/engine";
import { loadActorForUser } from "../context";
import { timingSafeEqual } from "../crypto";
import { getDb, schema } from "../db";
import { getEnv } from "../env";
import { AppError } from "../errors";
import { rememberedOrigin } from "../notify/queue";
import { confirmLinkCode, userByPhone } from "./link";
import { mediaUrl, normalizePhone, sendWhatsAppText, webhookKey } from "./whapi";

type WhapiMessage = {
  id: string;
  from?: string;
  chat_id?: string;
  from_me?: boolean;
  type?: string;
  text?: { body?: string };
  voice?: { id?: string; link?: string; mime_type?: string };
  audio?: { id?: string; link?: string; mime_type?: string };
};

async function alreadyHandled(externalId: string): Promise<boolean> {
  const row = await getDb().query.assistantMessages.findFirst({ where: and(eq(schema.assistantMessages.externalId, externalId)) });
  return Boolean(row);
}

async function downloadVoice(media: NonNullable<WhapiMessage["voice"]>): Promise<File | null> {
  const token = getEnv().WHAPI_TOKEN?.trim();
  const url = media.link ?? (media.id ? mediaUrl(media.id) : null);
  if (!url || !token) return null;
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const type = media.mime_type ?? res.headers.get("content-type") ?? "audio/ogg";
  return new File([await res.arrayBuffer()], `voice.${type.includes("ogg") ? "ogg" : "m4a"}`, { type });
}

async function handle(msg: WhapiMessage): Promise<void> {
  if (msg.from_me || !msg.id) return;
  const phone = normalizePhone(msg.from ?? msg.chat_id ?? "");
  if (!phone || (msg.chat_id ?? "").endsWith("@g.us")) return; // группы не обслуживаются
  const text = msg.text?.body?.trim() ?? "";

  // Привязка номера: сообщение — шестизначный код из профиля.
  const code = /^\D{0,20}(\d{6})\D{0,20}$/.exec(text)?.[1];
  if (code) {
    const linked = await confirmLinkCode(code, phone);
    if (linked) {
      await sendWhatsAppText(phone, `Номер привязан к аккаунту «${linked.displayName}». Пишите сюда, как в веб-чат помощника: «мои задачи», «помощь».`);
      return;
    }
  }

  const user = await userByPhone(phone);
  if (!user) return; // непривязанный номер ничего не получает
  const actor = await loadActorForUser(user.id, "whatsapp");
  if (!actor) return;
  if (await alreadyHandled(msg.id)) return; // повтор доставки вебхука

  let body = text;
  const media = msg.voice ?? msg.audio;
  if (!body && media) {
    if (!modelAvailable()) {
      await sendWhatsAppText(phone, "Голосовые сообщения доступны, когда задан ключ модели. Напишите текстом.");
      return;
    }
    const file = await downloadVoice(media);
    body = file ? await transcribe(file, companyConfig.assistant.transcribeModel).catch(() => "") : "";
    if (!body) {
      await sendWhatsAppText(phone, "Не удалось распознать голос. Напишите текстом.");
      return;
    }
  }
  if (!body) return;

  const { reply } = await sendMessage(actor, "whatsapp", body, msg.id);
  const origin = await rememberedOrigin();
  const links = origin ? reply.links.slice(0, 3).map((l) => `#${l.number}: ${origin}/tasks/${l.taskId}`) : [];
  await sendWhatsAppText(phone, [reply.text, ...links].join("\n"));
}

export async function handleWebhook(key: string, request: Request): Promise<{ ok: true; handled: number }> {
  const expected = await webhookKey();
  if (!expected || !timingSafeEqual(key, expected)) throw new AppError("not_found", 404);
  const payload = (await request.json().catch(() => null)) as { messages?: WhapiMessage[] } | null;
  const messages = payload?.messages ?? [];
  let handled = 0;
  for (const msg of messages.slice(0, 20)) {
    try {
      await handle(msg);
      handled++;
    } catch (error) {
      console.error("[whapi] message failed", error instanceof Error ? error.message : error);
    }
  }
  return { ok: true, handled };
}
