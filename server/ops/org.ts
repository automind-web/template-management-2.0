/** Компания, филиалы и участники. */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { companyConfig } from "../../config/company";
import { audit } from "../audit";
import type { Actor } from "../context";
import { newId } from "../crypto";
import { getDb, schema } from "../db";
import { AppError, notFound } from "../errors";
import {
  assertBranchAccess,
  assertCanManageMember,
  assertDirector,
  capabilities,
  isDirector,
  resolveBranchScope,
} from "../permissions";
import { revokeAllSessions } from "../session";
import { isValidTimeZone } from "../time";

// ---------- Текущий участник ----------

export async function me(actor: Actor) {
  const db = getDb();
  const statuses = await db
    .select()
    .from(schema.taskStatuses)
    .where(and(eq(schema.taskStatuses.companyId, actor.company.id), isNull(schema.taskStatuses.archivedAt)))
    .orderBy(asc(schema.taskStatuses.sort));
  const branch = actor.membership.branchId ? actor.branches.find((b) => b.id === actor.membership.branchId) : null;
  return {
    user: {
      id: actor.user.id,
      login: actor.user.login,
      displayName: actor.user.displayName,
      phoneLinked: Boolean(actor.user.phoneVerifiedAt),
      phoneMasked: actor.user.phone ? maskPhone(actor.user.phone) : null,
    },
    role: actor.membership.role,
    position: actor.membership.position,
    branch: branch ?? null,
    company: { id: actor.company.id, name: actor.company.name, timezone: actor.company.timezone },
    branches: actor.branches,
    capabilities: capabilities(actor),
    statuses: statuses.map((s) => ({ key: s.key, name: s.name, category: s.category })),
    assistantName: companyConfig.assistant.name,
  };
}

function maskPhone(phone: string): string {
  const digits = phone.replaceAll(/\D/g, "");
  return digits.length > 4 ? `+${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : phone;
}

// ---------- Компания ----------

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1, "required").max(120).optional(),
  timezone: z.string().trim().refine(isValidTimeZone, "timezone_invalid").optional(),
});

export async function updateCompany(actor: Actor, input: z.infer<typeof updateCompanySchema>) {
  assertDirector(actor);
  const patch: Partial<typeof schema.companies.$inferInsert> = { updatedAt: Date.now() };
  if (input.name) patch.name = input.name;
  if (input.timezone) patch.timezone = input.timezone;
  await getDb().update(schema.companies).set(patch).where(eq(schema.companies.id, actor.company.id));
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "company.updated", data: input });
  return { ok: true };
}

// ---------- Филиалы ----------

export const branchSchema = z.object({ name: z.string().trim().min(1, "required").max(120, "too_long") });

export async function listBranches(actor: Actor, includeArchived = false) {
  const db = getDb();
  const where = isDirector(actor)
    ? includeArchived
      ? eq(schema.branches.companyId, actor.company.id)
      : and(eq(schema.branches.companyId, actor.company.id), isNull(schema.branches.archivedAt))
    : and(eq(schema.branches.companyId, actor.company.id), eq(schema.branches.id, actor.membership.branchId!));
  const rows = await db.select().from(schema.branches).where(where).orderBy(asc(schema.branches.name));
  const counts = rows.length
    ? await db
        .select({ branchId: schema.memberships.branchId, n: sql<number>`count(*)` })
        .from(schema.memberships)
        .where(
          and(
            inArray(
              schema.memberships.branchId,
              rows.map((r) => r.id),
            ),
            isNull(schema.memberships.revokedAt),
          ),
        )
        .groupBy(schema.memberships.branchId)
    : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    archived: Boolean(r.archivedAt),
    members: Number(counts.find((c) => c.branchId === r.id)?.n ?? 0),
  }));
}

async function assertUniqueBranchName(companyId: string, name: string, exceptId?: string) {
  // SQLite lower() не работает с кириллицей — сравнение в JS.
  const rows = await getDb()
    .select({ id: schema.branches.id, name: schema.branches.name })
    .from(schema.branches)
    .where(and(eq(schema.branches.companyId, companyId), isNull(schema.branches.archivedAt)));
  const norm = (s: string) => s.trim().toLocaleLowerCase("ru").replaceAll(/\s+/g, " ");
  if (rows.some((r) => r.id !== exceptId && norm(r.name) === norm(name))) throw new AppError("branch_name_taken", 409, { fields: { name: "branch_name_taken" } });
}

export async function createBranch(actor: Actor, input: z.infer<typeof branchSchema>) {
  assertDirector(actor);
  await assertUniqueBranchName(actor.company.id, input.name);
  const id = newId();
  const now = Date.now();
  await getDb().insert(schema.branches).values({
    id,
    companyId: actor.company.id,
    name: input.name,
    createdBy: actor.user.id,
    createdAt: now,
    updatedAt: now,
  });
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "branch.created", targetType: "branch", targetId: id });
  return { id, name: input.name };
}

export async function renameBranch(actor: Actor, branchId: string, input: z.infer<typeof branchSchema>) {
  assertDirector(actor);
  assertBranchAccess(actor, branchId);
  await assertUniqueBranchName(actor.company.id, input.name, branchId);
  await getDb()
    .update(schema.branches)
    .set({ name: input.name, updatedAt: Date.now() })
    .where(and(eq(schema.branches.id, branchId), eq(schema.branches.companyId, actor.company.id)));
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "branch.renamed", targetType: "branch", targetId: branchId });
  return { ok: true };
}

export async function archiveBranch(actor: Actor, branchId: string) {
  assertDirector(actor);
  assertBranchAccess(actor, branchId);
  const db = getDb();
  const [active] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.branchId, branchId), isNull(schema.memberships.revokedAt)));
  if (Number(active?.n ?? 0) > 0) throw new AppError("branch_has_members", 409);
  await db
    .update(schema.branches)
    .set({ archivedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(schema.branches.id, branchId), eq(schema.branches.companyId, actor.company.id)));
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "branch.archived", targetType: "branch", targetId: branchId });
  return { ok: true };
}

// ---------- Участники ----------

export async function listMembers(actor: Actor, branch: string | null) {
  const scope = resolveBranchScope(actor, branch);
  const db = getDb();
  const conditions = [eq(schema.memberships.companyId, actor.company.id), isNull(schema.memberships.revokedAt)];
  const rows = await db
    .select({
      userId: schema.users.id,
      login: schema.users.login,
      displayName: schema.users.displayName,
      phoneVerifiedAt: schema.users.phoneVerifiedAt,
      role: schema.memberships.role,
      position: schema.memberships.position,
      branchId: schema.memberships.branchId,
      createdAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(...conditions))
    .orderBy(asc(schema.users.displayName));

  const director = isDirector(actor);
  const manager = actor.membership.role === "manager";
  return rows
    .filter((r) => {
      if (r.role === "director") return director; // директора видит только директор
      return r.branchId !== null && scope.includes(r.branchId);
    })
    .filter((r) => {
      // Сотрудник видит только себя (видимость коллег включается флагом).
      if (director || manager) return true;
      return r.userId === actor.user.id || companyConfig.rules.employeeSeesColleagues;
    })
    .map((r) => ({
      userId: r.userId,
      login: director || manager ? r.login : undefined,
      displayName: r.displayName,
      role: r.role,
      position: r.position,
      branchId: r.branchId,
      branchName: actor.branches.find((b) => b.id === r.branchId)?.name ?? null,
      phoneLinked: Boolean(r.phoneVerifiedAt),
      self: r.userId === actor.user.id,
    }));
}

export const updateMemberSchema = z.object({
  role: z.enum(["employee", "manager"]).optional(),
  branchId: z.string().min(1).optional(),
  position: z.string().trim().max(120).nullable().optional(),
});

async function loadMember(actor: Actor, userId: string) {
  const membership = await getDb().query.memberships.findFirst({
    where: and(
      eq(schema.memberships.userId, userId),
      eq(schema.memberships.companyId, actor.company.id),
      isNull(schema.memberships.revokedAt),
    ),
  });
  if (!membership) throw notFound();
  return membership;
}

/** Смена роли, перевод в другой филиал. Ограничения действуют со следующего запроса. */
export async function updateMember(actor: Actor, userId: string, input: z.infer<typeof updateMemberSchema>) {
  const membership = await loadMember(actor, userId);
  assertCanManageMember(actor, { userId, role: membership.role, branchId: membership.branchId });
  if (input.branchId) assertBranchAccess(actor, input.branchId);
  const patch: Partial<typeof schema.memberships.$inferInsert> = { updatedAt: Date.now() };
  if (input.role) patch.role = input.role;
  if (input.branchId) patch.branchId = input.branchId;
  if (input.position !== undefined) patch.position = input.position;
  await getDb().update(schema.memberships).set(patch).where(eq(schema.memberships.id, membership.id));
  await audit({
    companyId: actor.company.id,
    actorId: actor.user.id,
    action: "member.updated",
    targetType: "user",
    targetId: userId,
    data: { from: { role: membership.role, branchId: membership.branchId }, to: input },
  });
  return { ok: true };
}

/** Отзыв доступа: членство закрывается, все сессии участника отзываются. */
export async function revokeMember(actor: Actor, userId: string) {
  const membership = await loadMember(actor, userId);
  assertCanManageMember(actor, { userId, role: membership.role, branchId: membership.branchId });
  await getDb()
    .update(schema.memberships)
    .set({ revokedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(schema.memberships.id, membership.id));
  await revokeAllSessions(userId);
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "member.revoked", targetType: "user", targetId: userId });
  return { ok: true };
}
