import { eq } from "drizzle-orm";
import { companyConfig } from "../config/company";
import { getDb, schema } from "./db";
import { AppError } from "./errors";

/** Блокировка перебора: после N ошибок ключ блокируется на lockMinutes. */
export async function assertNotLocked(key: string): Promise<void> {
  const db = getDb();
  const row = await db.query.authThrottle.findFirst({ where: eq(schema.authThrottle.key, key) });
  if (row?.lockedUntil && row.lockedUntil > Date.now()) {
    throw new AppError("too_many_attempts", 429, { retryAfterMs: row.lockedUntil - Date.now() });
  }
}

export async function registerFailure(key: string): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const row = await db.query.authThrottle.findFirst({ where: eq(schema.authThrottle.key, key) });
  const expired = row?.lockedUntil && row.lockedUntil <= now;
  const failures = (expired ? 0 : (row?.failures ?? 0)) + 1;
  const lockedUntil =
    failures >= companyConfig.auth.maxLoginFailures ? now + companyConfig.auth.lockMinutes * 60_000 : null;
  await db
    .insert(schema.authThrottle)
    .values({ key, failures, lockedUntil, updatedAt: now })
    .onConflictDoUpdate({ target: schema.authThrottle.key, set: { failures, lockedUntil, updatedAt: now } });
}

export async function clearFailures(key: string): Promise<void> {
  await getDb().delete(schema.authThrottle).where(eq(schema.authThrottle.key, key));
}
