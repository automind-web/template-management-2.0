import { and, eq, isNull } from "drizzle-orm";
import { companyConfig } from "../config/company";
import { randomToken, newId, sha256Hex } from "./crypto";
import { getDb, schema } from "./db";

const DAY = 24 * 60 * 60 * 1000;
/** Как часто обновлять last_seen_at (чтобы не писать в БД на каждый запрос). */
const TOUCH_INTERVAL = 5 * 60 * 1000;

export type SessionRow = typeof schema.sessions.$inferSelect;

export function sessionTtlMs(): number {
  return companyConfig.auth.sessionTtlDays * DAY;
}

export async function createSession(userId: string, userAgent: string | null): Promise<{ token: string; session: SessionRow }> {
  const db = getDb();
  const token = randomToken();
  const now = Date.now();
  const row: SessionRow = {
    id: newId(),
    tokenHash: await sha256Hex(token),
    userId,
    userAgent: userAgent?.slice(0, 300) ?? null,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + sessionTtlMs(),
    revokedAt: null,
  };
  await db.insert(schema.sessions).values(row);
  return { token, session: row };
}

/** Находит действующую сессию по значению cookie. */
export async function findSession(token: string | undefined | null): Promise<SessionRow | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const db = getDb();
  const tokenHash = await sha256Hex(token);
  const row = await db.query.sessions.findFirst({
    where: and(eq(schema.sessions.tokenHash, tokenHash), isNull(schema.sessions.revokedAt)),
  });
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt <= now) return null;
  if (now - row.lastSeenAt > TOUCH_INTERVAL) {
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: now, expiresAt: now + sessionTtlMs() })
      .where(eq(schema.sessions.id, row.id));
  }
  return row;
}

export async function revokeSession(sessionId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.sessions)
    .set({ revokedAt: Date.now() })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
  // Push-подписки устройства этой сессии больше не получают уведомления.
  await db
    .update(schema.pushSubscriptions)
    .set({ revokedAt: Date.now() })
    .where(and(eq(schema.pushSubscriptions.sessionId, sessionId), isNull(schema.pushSubscriptions.revokedAt)));
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
  for (const r of rows) {
    if (r.id !== exceptSessionId) await revokeSession(r.id);
  }
}
