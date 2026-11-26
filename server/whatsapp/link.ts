/**
 * Привязка номера WhatsApp: участник получает в профиле одноразовый код и отправляет его
 * со своего WhatsApp на рабочий номер компании. Номер берётся из входящего сообщения —
 * так подтверждается, что телефон принадлежит участнику.
 */
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { Actor } from "../context";
import { newId } from "../crypto";
import { getDb, schema } from "../db";
import { AppError } from "../errors";
import { whapiConfigured } from "./whapi";

const TTL = 15 * 60_000;

function sixDigits(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function issueLinkCode(actor: Actor) {
  if (!(await whapiConfigured())) throw new AppError("whatsapp_unavailable", 503);
  const db = getDb();
  const now = Date.now();
  await db
    .update(schema.phoneLinkCodes)
    .set({ usedAt: now })
    .where(and(eq(schema.phoneLinkCodes.userId, actor.user.id), isNull(schema.phoneLinkCodes.usedAt)));
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = sixDigits();
    try {
      await db.insert(schema.phoneLinkCodes).values({ id: newId(), userId: actor.user.id, code, expiresAt: now + TTL, createdAt: now });
      return { code, expiresAt: now + TTL, workNumber: actor.settings.whapiPhone || null };
    } catch {
      /* совпадение кода — пробуем другой */
    }
  }
  throw new AppError("internal", 500);
}

/** Код из входящего сообщения. Возвращает имя участника, если номер привязан. */
export async function confirmLinkCode(code: string, phone: string): Promise<{ userId: string; displayName: string } | null> {
  const db = getDb();
  const now = Date.now();
  const claimed = await db
    .update(schema.phoneLinkCodes)
    .set({ usedAt: now, phone })
    .where(and(eq(schema.phoneLinkCodes.code, code), isNull(schema.phoneLinkCodes.usedAt), gt(schema.phoneLinkCodes.expiresAt, now)))
    .returning({ userId: schema.phoneLinkCodes.userId });
  if (claimed.length !== 1) return null;
  const userId = claimed[0]!.userId;
  // Один номер — один участник: у других привязка снимается.
  await db.update(schema.users).set({ phone: null, phoneVerifiedAt: null }).where(and(eq(schema.users.phone, phone), ne(schema.users.id, userId)));
  await db.update(schema.users).set({ phone, phoneVerifiedAt: now, updatedAt: now }).where(eq(schema.users.id, userId));
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  return user ? { userId, displayName: user.displayName } : null;
}

export async function unlinkPhone(actor: Actor) {
  await getDb().update(schema.users).set({ phone: null, phoneVerifiedAt: null, updatedAt: Date.now() }).where(eq(schema.users.id, actor.user.id));
  return { ok: true };
}

export async function userByPhone(phone: string) {
  const user = await getDb().query.users.findFirst({ where: and(eq(schema.users.phone, phone), isNull(schema.users.disabledAt)) });
  return user?.phoneVerifiedAt ? user : null;
}
