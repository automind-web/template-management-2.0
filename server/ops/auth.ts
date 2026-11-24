import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { companyConfig } from "../../config/company";
import { audit } from "../audit";
import type { Actor } from "../context";
import { newId, randomCode, sha256Hex } from "../crypto";
import { getDb, schema } from "../db";
import { AppError, notFound } from "../errors";
import { dummyVerify, hashPassword, verifyPassword } from "../password";
import { assertCanManageMember } from "../permissions";
import { createSession, revokeAllSessions, revokeSession } from "../session";
import { assertNotLocked, clearFailures, registerFailure } from "../throttle";
import { displayNameSchema, passwordSchema } from "./invites";

export const loginInputSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, "required").max(40),
  password: z.string().min(1, "required").max(200),
});

export async function login(input: z.infer<typeof loginInputSchema>, userAgent: string | null) {
  const key = `login:${input.login}`;
  await assertNotLocked(key);
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.login, input.login) });
  if (!user) {
    await dummyVerify(input.password);
    await registerFailure(key);
    throw new AppError("invalid_credentials", 401);
  }
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) {
    await registerFailure(key);
    throw new AppError("invalid_credentials", 401);
  }
  if (user.disabledAt) throw new AppError("access_revoked", 403);
  const membership = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, user.id), isNull(schema.memberships.revokedAt)),
  });
  if (!membership) throw new AppError("access_revoked", 403);
  await clearFailures(key);
  const { token } = await createSession(user.id, userAgent);
  await audit({ companyId: membership.companyId, actorId: user.id, action: "auth.login" });
  return { token };
}

export async function logout(actor: Actor) {
  await revokeSession(actor.session.id);
  return { ok: true };
}

// ---------- Восстановление пароля ----------

/** Директор выдаёт одноразовый код восстановления участнику. */
export async function issueResetCode(actor: Actor, userId: string) {
  const db = getDb();
  const membership = await db.query.memberships.findFirst({
    where: and(
      eq(schema.memberships.userId, userId),
      eq(schema.memberships.companyId, actor.company.id),
      isNull(schema.memberships.revokedAt),
    ),
  });
  if (!membership) throw notFound();
  assertCanManageMember(actor, { userId, role: membership.role, branchId: membership.branchId });
  const now = Date.now();
  await db
    .update(schema.passwordResets)
    .set({ revokedAt: now })
    .where(and(eq(schema.passwordResets.userId, userId), isNull(schema.passwordResets.usedAt), isNull(schema.passwordResets.revokedAt)));
  const code = randomCode(10);
  const expiresAt = now + companyConfig.auth.resetCodeTtlHours * 3600_000;
  await db.insert(schema.passwordResets).values({
    id: newId(),
    userId,
    codeHash: await sha256Hex(code),
    channel: "director",
    createdBy: actor.user.id,
    expiresAt,
    createdAt: now,
  });
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "password.reset_code_issued", targetType: "user", targetId: userId });
  return { code, expiresAt };
}

export const recoverSchema = z.object({
  login: z.string().trim().toLowerCase().min(1, "required").max(40),
  code: z.string().trim().toUpperCase().min(4, "required").max(20),
  password: passwordSchema,
});

export async function recoverPassword(input: z.infer<typeof recoverSchema>) {
  const key = `recover:${input.login}`;
  await assertNotLocked(key);
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.login, input.login) });
  const now = Date.now();
  const codeHash = await sha256Hex(input.code.replaceAll(/[\s-]/g, ""));
  const reset = user
    ? await db.query.passwordResets.findFirst({
        where: and(
          eq(schema.passwordResets.userId, user.id),
          eq(schema.passwordResets.codeHash, codeHash),
          isNull(schema.passwordResets.usedAt),
          isNull(schema.passwordResets.revokedAt),
          gt(schema.passwordResets.expiresAt, now),
        ),
        orderBy: desc(schema.passwordResets.createdAt),
      })
    : null;
  if (!user || !reset) {
    await registerFailure(key);
    throw new AppError("reset_code_invalid", 400);
  }
  const claim = await db
    .update(schema.passwordResets)
    .set({ usedAt: now })
    .where(and(eq(schema.passwordResets.id, reset.id), isNull(schema.passwordResets.usedAt)))
    .returning({ id: schema.passwordResets.id });
  if (claim.length !== 1) throw new AppError("reset_code_invalid", 400);
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(input.password), updatedAt: now })
    .where(eq(schema.users.id, user.id));
  await revokeAllSessions(user.id);
  await clearFailures(key);
  await clearFailures(`login:${input.login}`);
  await audit({ companyId: null, actorId: user.id, action: "password.recovered", data: { channel: reset.channel } });
  return { ok: true };
}

// ---------- Профиль ----------

export const updateProfileSchema = z.object({ displayName: displayNameSchema });

export async function updateProfile(actor: Actor, input: z.infer<typeof updateProfileSchema>) {
  await getDb()
    .update(schema.users)
    .set({ displayName: input.displayName, updatedAt: Date.now() })
    .where(eq(schema.users.id, actor.user.id));
  return { ok: true };
}

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "required").max(200),
  newPassword: passwordSchema,
});

export async function changePassword(actor: Actor, input: z.infer<typeof changePasswordSchema>) {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, actor.user.id) });
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new AppError("invalid_current_password", 400, { fields: { currentPassword: "invalid_current_password" } });
  }
  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: Date.now() })
    .where(eq(schema.users.id, actor.user.id));
  await revokeAllSessions(actor.user.id, actor.session.id);
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "password.changed" });
  return { ok: true };
}

export async function listSessions(actor: Actor) {
  const rows = await getDb()
    .select({
      id: schema.sessions.id,
      userAgent: schema.sessions.userAgent,
      createdAt: schema.sessions.createdAt,
      lastSeenAt: schema.sessions.lastSeenAt,
    })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.userId, actor.user.id),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, Date.now()),
      ),
    )
    .orderBy(desc(schema.sessions.lastSeenAt));
  return rows.map((r) => ({ ...r, current: r.id === actor.session.id }));
}

export async function revokeOwnSession(actor: Actor, sessionId: string) {
  const row = await getDb().query.sessions.findFirst({
    where: and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, actor.user.id)),
  });
  if (!row) throw notFound();
  await revokeSession(sessionId);
  return { ok: true, current: sessionId === actor.session.id };
}
