/**
 * Приглашения. Открытие ссылки и ошибки в форме приглашение НЕ гасят.
 * Успешная регистрация гасит его ровно один раз (условное обновление used_at IS NULL).
 */
import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { companyConfig } from "../../config/company";
import type { Role } from "../../db/schema";
import { audit } from "../audit";
import type { Actor } from "../context";
import { newId, randomToken, sha256Hex } from "../crypto";
import { getDb, schema } from "../db";
import { AppError, notFound } from "../errors";
import { hashPassword, verifyPassword } from "../password";
import { assertCanInvite, isDirector } from "../permissions";
import { createSession } from "../session";
import { assertNotLocked, clearFailures, registerFailure } from "../throttle";

export const loginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "login_short")
  .max(40, "login_long")
  .regex(/^[a-z0-9._-]+$/, "login_chars");

export const passwordSchema = z
  .string()
  .min(companyConfig.auth.minPasswordLength, "password_short")
  .max(200, "password_long");

export const displayNameSchema = z.string().trim().min(1, "required").max(120, "too_long");

type InviteRow = typeof schema.invitations.$inferSelect;

function inviteState(row: InviteRow, now = Date.now()) {
  if (row.usedAt) return "used" as const;
  if (row.revokedAt) return "revoked" as const;
  if (row.expiresAt <= now) return "expired" as const;
  return "active" as const;
}

// ---------- Выпуск, список, отзыв ----------

export const createInviteSchema = z.object({
  role: z.enum(["employee", "manager"]),
  branchId: z.string().min(1, "required"),
  /** Подсказка имени: подставляется в форму регистрации. */
  note: z.string().trim().max(120).optional().nullable(),
  ttlHours: z.number().int().min(1, "ttl_invalid").max(720, "ttl_invalid").optional(),
});

export async function createInvite(actor: Actor, input: z.infer<typeof createInviteSchema>) {
  assertCanInvite(actor, input.role as Role, input.branchId);
  const token = randomToken();
  const now = Date.now();
  const id = newId();
  const expiresAt = now + (input.ttlHours ?? companyConfig.invitations.memberTtlHours) * 3600_000;
  await getDb().insert(schema.invitations).values({
    id,
    kind: "member",
    companyId: actor.company.id,
    branchId: input.branchId,
    role: input.role,
    tokenHash: await sha256Hex(token),
    note: input.note || null,
    createdBy: actor.user.id,
    expiresAt,
    createdAt: now,
  });
  await audit({
    companyId: actor.company.id,
    actorId: actor.user.id,
    action: "invite.created",
    targetType: "invitation",
    targetId: id,
    data: { role: input.role, branchId: input.branchId },
  });
  return { id, token, expiresAt };
}

export async function listInvites(actor: Actor) {
  const db = getDb();
  const director = isDirector(actor);
  const branchIds = director ? actor.branches.map((b) => b.id) : [actor.membership.branchId!];
  const scope = [inArray(schema.invitations.branchId, branchIds.length ? branchIds : ["-"])];
  // Директор видит и приглашение владельца (первого директора).
  if (director) scope.push(eq(schema.invitations.kind, "owner"));
  const rows = await db
    .select()
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.companyId, actor.company.id),
        or(...scope),
        gt(schema.invitations.createdAt, Date.now() - 90 * 86400_000),
      ),
    )
    .orderBy(desc(schema.invitations.createdAt))
    .limit(200);
  const userIds = [...new Set(rows.flatMap((r) => [r.createdBy, r.usedBy]).filter(Boolean) as string[])];
  const people = userIds.length
    ? await db
        .select({ id: schema.users.id, displayName: schema.users.displayName })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds))
    : [];
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.displayName ?? null;
  return rows
    .filter((r) => r.kind === "member" || r.usedAt) // невостребованные приглашения владельца не показываются
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      role: r.role,
      branchId: r.branchId,
      branchName: actor.branches.find((b) => b.id === r.branchId)?.name ?? null,
      note: r.note,
      state: inviteState(r),
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      createdBy: nameOf(r.createdBy),
      usedBy: nameOf(r.usedBy),
    }));
}

export async function revokeInvite(actor: Actor, inviteId: string) {
  const db = getDb();
  const row = await db.query.invitations.findFirst({
    where: and(eq(schema.invitations.id, inviteId), eq(schema.invitations.companyId, actor.company.id)),
  });
  if (!row || row.kind !== "member" || !row.branchId) throw notFound();
  assertCanInvite(actor, row.role, row.branchId);
  if (inviteState(row) !== "active") throw new AppError("invite_not_active", 409);
  await db
    .update(schema.invitations)
    .set({ revokedAt: Date.now(), revokedBy: actor.user.id })
    .where(and(eq(schema.invitations.id, inviteId), isNull(schema.invitations.usedAt)));
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "invite.revoked", targetType: "invitation", targetId: inviteId });
  return { ok: true };
}

// ---------- По ссылке ----------

async function findInviteByToken(token: string) {
  if (!token || token.length < 20 || token.length > 200) return null;
  return getDb().query.invitations.findFirst({ where: eq(schema.invitations.tokenHash, await sha256Hex(token)) });
}

/** Просмотр приглашения по ссылке. Ничего не гасит. */
export async function lookupInvite(token: string) {
  const row = await findInviteByToken(token);
  if (!row) return { valid: false, reason: "invite_not_found" as const };
  const state = inviteState(row);
  if (state !== "active") return { valid: false, reason: `invite_${state}` as const };
  const db = getDb();
  const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, row.companyId) });
  const branch = row.branchId ? await db.query.branches.findFirst({ where: eq(schema.branches.id, row.branchId) }) : null;
  return {
    valid: true,
    reason: null,
    kind: row.kind,
    role: row.role,
    companyName: company?.name ?? "",
    branchName: branch?.name ?? null,
    nameHint: row.note,
    expiresAt: row.expiresAt,
  };
}

async function loadActiveInvite(token: string): Promise<InviteRow> {
  const row = await findInviteByToken(token);
  if (!row) throw new AppError("invite_not_found", 404);
  const state = inviteState(row);
  if (state !== "active") throw new AppError(`invite_${state}`, 410);
  if (row.branchId) {
    const branch = await getDb().query.branches.findFirst({ where: eq(schema.branches.id, row.branchId) });
    if (!branch || branch.archivedAt) throw new AppError("invite_revoked", 410);
  }
  return row;
}

/** Погашение: ровно один успешный запрос получит строку. */
async function claimInvite(row: InviteRow, userId: string): Promise<void> {
  const now = Date.now();
  const claim = await getDb()
    .update(schema.invitations)
    .set({ usedAt: now, usedBy: userId })
    .where(
      and(
        eq(schema.invitations.id, row.id),
        isNull(schema.invitations.usedAt),
        isNull(schema.invitations.revokedAt),
        gt(schema.invitations.expiresAt, now),
      ),
    )
    .returning({ id: schema.invitations.id });
  if (claim.length !== 1) throw new AppError("invite_used", 410);
}

async function releaseInvite(row: InviteRow, userId: string): Promise<void> {
  await getDb()
    .update(schema.invitations)
    .set({ usedAt: null, usedBy: null })
    .where(and(eq(schema.invitations.id, row.id), eq(schema.invitations.usedBy, userId)));
}

function membershipValues(row: InviteRow, userId: string, now: number) {
  return {
    id: newId(),
    userId,
    companyId: row.companyId,
    branchId: row.role === "director" ? null : row.branchId,
    role: row.role,
    canInvite: row.role === "manager",
    createdAt: now,
    updatedAt: now,
  };
}

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  login: loginSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

/** Новый аккаунт по приглашению. */
export async function acceptInvite(input: z.infer<typeof acceptInviteSchema>, userAgent: string | null) {
  const db = getDb();
  const row = await loadActiveInvite(input.token);
  // Проверки формы — до погашения: ошибка не гасит приглашение.
  const taken = await db.query.users.findFirst({ where: eq(schema.users.login, input.login) });
  if (taken) throw new AppError("login_taken", 409, { fields: { login: "login_taken" } });
  const passwordHash = await hashPassword(input.password);

  const now = Date.now();
  const userId = newId();
  await claimInvite(row, userId);
  try {
    await db.batch([
      db.insert(schema.users).values({
        id: userId,
        login: input.login,
        displayName: input.displayName,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(schema.memberships).values(membershipValues(row, userId, now)),
    ]);
  } catch (error) {
    await releaseInvite(row, userId);
    const message = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : "";
    if (message.includes("UNIQUE")) throw new AppError("login_taken", 409, { fields: { login: "login_taken" } });
    throw error;
  }

  await audit({
    companyId: row.companyId,
    actorId: userId,
    action: row.kind === "owner" ? "director.activated" : "invite.accepted",
    targetType: "invitation",
    targetId: row.id,
  });
  const { token } = await createSession(userId, userAgent);
  return { token, userId };
}

export const acceptExistingSchema = z.object({
  token: z.string().min(20).max(200),
  login: z.string().trim().toLowerCase().min(1, "required").max(40),
  password: z.string().min(1, "required").max(200),
});

/**
 * «У меня есть аккаунт»: участник без действующего членства (например, доступ был отозван)
 * подтверждает логин и пароль и получает новую роль по приглашению.
 */
export async function acceptInviteExisting(input: z.infer<typeof acceptExistingSchema>, userAgent: string | null) {
  const key = `login:${input.login}`;
  await assertNotLocked(key);
  const db = getDb();
  const row = await loadActiveInvite(input.token);
  const user = await db.query.users.findFirst({ where: eq(schema.users.login, input.login) });
  if (!user || user.disabledAt || !(await verifyPassword(input.password, user.passwordHash))) {
    await registerFailure(key);
    throw new AppError("invalid_credentials", 401);
  }
  await clearFailures(key);
  const active = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, user.id), isNull(schema.memberships.revokedAt)),
  });
  if (active) throw new AppError("already_member", 409);

  await claimInvite(row, user.id);
  try {
    await db.insert(schema.memberships).values(membershipValues(row, user.id, Date.now()));
  } catch (error) {
    await releaseInvite(row, user.id);
    throw error;
  }
  await audit({ companyId: row.companyId, actorId: user.id, action: "invite.accepted_existing", targetType: "invitation", targetId: row.id });
  const { token } = await createSession(user.id, userAgent);
  return { token, userId: user.id };
}
