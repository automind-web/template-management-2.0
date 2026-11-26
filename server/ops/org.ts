/** Компания, настройки, филиалы и участники. */
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { audit } from "../audit";
import type { Actor } from "../context";
import { newId } from "../crypto";
import { getDb, schema } from "../db";
import { getEnv, hasSecret } from "../env";
import { AppError, forbidden, notFound } from "../errors";
import {
  assertBranchAccess,
  assertCanManageMember,
  assertDirector,
  assertManagerOrDirector,
  capabilities,
  isDirector,
  resolveBranchScope,
} from "../permissions";
import { revokeAllSessions } from "../session";
import { ASSISTANT_MODELS, companySettingsSchema, saveSettings } from "../settings";
import { dueMomentInZone, isValidTimeZone } from "../time";
import { seedWorkflow } from "./setup";

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
    cancelledName: actor.settings.cancelledName,
    dueTime: actor.settings.dueTime,
    branding: { accent: actor.settings.accent, logoUrl: actor.settings.logoUrl, fontFamily: actor.settings.fontFamily },
    assistantName: actor.settings.assistantName,
  };
}

function maskPhone(phone: string): string {
  const digits = phone.replaceAll(/\D/g, "");
  return digits.length > 4 ? `+${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : phone;
}

// ---------- Настройки системы ----------

/** Всё, что нужно вкладкам «Компания» и «Процесс». */
export async function getSystemSettings(actor: Actor) {
  assertDirector(actor);
  const statuses = await getDb()
    .select()
    .from(schema.taskStatuses)
    .where(eq(schema.taskStatuses.companyId, actor.company.id))
    .orderBy(asc(schema.taskStatuses.sort));
  return {
    company: { name: actor.company.name, timezone: actor.company.timezone },
    settings: actor.settings,
    statuses: statuses.map((s) => ({ key: s.key, name: s.name, category: s.category })),
    timezones: Intl.supportedValuesOf("timeZone"),
    models: ASSISTANT_MODELS,
  };
}

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1, "required").max(120, "too_long"),
  timezone: z.string().trim().refine(isValidTimeZone, "timezone_invalid"),
  accent: companySettingsSchema.shape.accent,
  logoUrl: companySettingsSchema.shape.logoUrl,
  fontFamily: companySettingsSchema.shape.fontFamily,
  dueTime: companySettingsSchema.shape.dueTime,
  workDays: companySettingsSchema.shape.workDays,
});

/** Вкладка «Компания»: название, оформление, часовой пояс, срок по умолчанию, рабочие дни. */
export async function updateCompany(actor: Actor, input: z.infer<typeof updateCompanySchema>) {
  assertDirector(actor);
  const db = getDb();
  await db
    .update(schema.companies)
    .set({ name: input.name, timezone: input.timezone, updatedAt: Date.now() })
    .where(eq(schema.companies.id, actor.company.id));
  const settings = await saveSettings(
    actor.company.id,
    { accent: input.accent, logoUrl: input.logoUrl, fontFamily: input.fontFamily, dueTime: input.dueTime, workDays: input.workDays },
    actor.user.id,
  );
  // Пояс или время срока по умолчанию изменились — пересчитать моменты сроков открытых задач.
  if (input.timezone !== actor.company.timezone || input.dueTime !== actor.settings.dueTime) {
    const open = await db
      .select({ id: schema.tasks.id, dueDate: schema.tasks.dueDate, dueTime: schema.tasks.dueTime })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.companyId, actor.company.id), isNotNull(schema.tasks.dueDate), isNull(schema.tasks.completedAt)));
    for (const t of open) {
      const dueAt = dueMomentInZone(t.dueDate!, t.dueTime ?? settings.dueTime, input.timezone);
      await db.update(schema.tasks).set({ dueAt }).where(eq(schema.tasks.id, t.id));
    }
  }
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "company.updated" });
  return { ok: true };
}

export const updateProcessSchema = z.object({
  acceptanceEnabled: z.boolean(),
  statusNames: z.record(z.string(), z.string().trim().min(1, "required").max(40, "too_long")),
  cancelledName: companySettingsSchema.shape.cancelledName,
  employeeSeesColleagues: z.boolean(),
  speedFrom: companySettingsSchema.shape.speedFrom,
  assistantName: companySettingsSchema.shape.assistantName,
  assistantModel: companySettingsSchema.shape.assistantModel,
});

/** Вкладка «Процесс»: приёмка, названия статусов, видимость, методика статистики, помощник. */
export async function updateProcess(actor: Actor, input: z.infer<typeof updateProcessSchema>) {
  assertDirector(actor);
  const db = getDb();
  for (const [key, name] of Object.entries(input.statusNames)) {
    await db
      .update(schema.taskStatuses)
      .set({ name })
      .where(and(eq(schema.taskStatuses.companyId, actor.company.id), eq(schema.taskStatuses.key, key)));
  }
  const { statusNames: _ignored, ...rest } = input;
  await saveSettings(actor.company.id, rest, actor.user.id);
  if (input.acceptanceEnabled !== actor.settings.acceptanceEnabled) await seedWorkflow(actor.company.id, input.acceptanceEnabled);
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "process.updated" });
  return { ok: true };
}

// ---------- Филиалы ----------

export const branchSchema = z.object({ name: z.string().trim().min(1, "required").max(120, "too_long") });

export async function listBranches(actor: Actor) {
  const rows = await getDb()
    .select()
    .from(schema.branches)
    .where(
      isDirector(actor)
        ? and(eq(schema.branches.companyId, actor.company.id), isNull(schema.branches.archivedAt))
        : and(eq(schema.branches.companyId, actor.company.id), eq(schema.branches.id, actor.membership.branchId!)),
    )
    .orderBy(asc(schema.branches.name));
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

async function assertUniqueBranchName(companyId: string, name: string, exceptId?: string) {
  // SQLite lower() не работает с кириллицей — сравнение в JS.
  const rows = await getDb()
    .select({ id: schema.branches.id, name: schema.branches.name })
    .from(schema.branches)
    .where(and(eq(schema.branches.companyId, companyId), isNull(schema.branches.archivedAt)));
  const norm = (s: string) => s.trim().toLocaleLowerCase("ru").replaceAll(/\s+/g, " ");
  if (rows.some((r) => r.id !== exceptId && norm(r.name) === norm(name))) {
    throw new AppError("branch_name_taken", 409, { fields: { name: "branch_name_taken" } });
  }
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

/**
 * Директор видит всех (включая отозванных — их можно вернуть), руководитель — свой филиал,
 * сотрудник — себя (или коллег филиала, если это включено в «Процессе»).
 */
export async function listMembers(actor: Actor, branch: string | null) {
  const scope = resolveBranchScope(actor, branch);
  const director = isDirector(actor);
  const manager = actor.membership.role === "manager";
  const rows = await getDb()
    .select({
      userId: schema.users.id,
      login: schema.users.login,
      displayName: schema.users.displayName,
      phoneVerifiedAt: schema.users.phoneVerifiedAt,
      role: schema.memberships.role,
      position: schema.memberships.position,
      branchId: schema.memberships.branchId,
      canInvite: schema.memberships.canInvite,
      revokedAt: schema.memberships.revokedAt,
      createdAt: schema.memberships.createdAt,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.companyId, actor.company.id), director ? undefined : isNull(schema.memberships.revokedAt)))
    .orderBy(asc(schema.memberships.createdAt));

  // У отозванного участника может быть несколько старых членств — показывается последнее.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prev = latest.get(r.userId);
    if (!prev || (prev.revokedAt && !r.revokedAt) || (Boolean(prev.revokedAt) === Boolean(r.revokedAt) && r.createdAt > prev.createdAt)) {
      latest.set(r.userId, r);
    }
  }

  const order = { manager: 0, employee: 1, director: 2 } as const;
  return [...latest.values()]
    .filter((r) => (r.role === "director" ? director : r.branchId !== null && scope.includes(r.branchId)))
    .filter((r) => director || manager || r.userId === actor.user.id || actor.settings.employeeSeesColleagues)
    .sort((a, b) => order[a.role] - order[b.role] || a.displayName.localeCompare(b.displayName, "ru"))
    .map((r) => ({
      userId: r.userId,
      login: director || manager ? r.login : undefined,
      displayName: r.displayName,
      role: r.role,
      position: r.position,
      branchId: r.branchId,
      branchName: actor.branches.find((b) => b.id === r.branchId)?.name ?? null,
      phoneLinked: Boolean(r.phoneVerifiedAt),
      canInvite: r.canInvite,
      active: !r.revokedAt,
      self: r.userId === actor.user.id,
    }));
}

export const updateMemberSchema = z.object({
  role: z.enum(["employee", "manager"]).optional(),
  branchId: z.string().min(1).optional(),
  position: z.string().trim().max(120).nullable().optional(),
  canInvite: z.boolean().optional(),
  /** false — отозвать доступ (сессии завершаются сразу), true — вернуть. */
  active: z.boolean().optional(),
});

/** Роль, филиал, право приглашать, доступ. Ограничения действуют со следующего запроса. */
export async function updateMember(actor: Actor, userId: string, input: z.infer<typeof updateMemberSchema>) {
  assertDirector(actor);
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.companyId, actor.company.id)))
    .orderBy(asc(schema.memberships.createdAt));
  const membership = rows.find((r) => !r.revokedAt) ?? rows.at(-1);
  if (!membership) throw notFound();
  assertCanManageMember(actor, { userId, role: membership.role, branchId: membership.branchId });
  if (input.branchId) assertBranchAccess(actor, input.branchId);

  const now = Date.now();
  const patch: Partial<typeof schema.memberships.$inferInsert> = { updatedAt: now };
  if (input.role) patch.role = input.role;
  if (input.branchId) patch.branchId = input.branchId;
  if (input.position !== undefined) patch.position = input.position;
  if (input.canInvite !== undefined) patch.canInvite = input.canInvite;
  if (input.role === "manager" && membership.role !== "manager" && input.canInvite === undefined) patch.canInvite = true;
  if (input.active === false && !membership.revokedAt) patch.revokedAt = now;
  if (input.active === true && membership.revokedAt) {
    const branch = await db.query.branches.findFirst({ where: eq(schema.branches.id, patch.branchId ?? membership.branchId ?? "") });
    if (!branch || branch.archivedAt) throw new AppError("branch_required", 400);
    patch.revokedAt = null;
  }
  await db.update(schema.memberships).set(patch).where(eq(schema.memberships.id, membership.id));
  if (patch.revokedAt) await revokeAllSessions(userId);
  await audit({
    companyId: actor.company.id,
    actorId: actor.user.id,
    action: input.active === false ? "member.revoked" : input.active === true ? "member.restored" : "member.updated",
    targetType: "user",
    targetId: userId,
    data: { from: { role: membership.role, branchId: membership.branchId }, to: input },
  });
  return { ok: true };
}

// ---------- Подключения ----------

/** Реальное состояние подключений. Возвращается только факт наличия секретов, не значения. */
export async function connections(actor: Actor) {
  assertManagerOrDirector(actor);
  if (!isDirector(actor)) throw forbidden();
  const env = getEnv();
  const push = hasSecret("VAPID_PUBLIC_KEY") && hasSecret("VAPID_PRIVATE_KEY");
  return {
    whapi: { ok: false, configured: hasSecret("WHAPI_TOKEN") },
    openai: { ok: hasSecret("OPENAI_API_KEY"), configured: hasSecret("OPENAI_API_KEY") },
    push: { ok: push, configured: push },
    files: { ok: Boolean(env.BUCKET), configured: Boolean(env.BUCKET) },
    db: { ok: Boolean(env.DB) },
  };
}


