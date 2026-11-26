/** Компания, настройки, филиалы и участники. */
import { and, asc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
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
import { getEnv } from "../env";
import { ASSISTANT_MODELS, companySettingsSchema, saveSettings } from "../settings";
import { dueMomentInZone, isValidTimeZone } from "../time";
import { saveSecret, secretInfo } from "../integrations";
import { registerWebhook, whapiHealth, webhookKey } from "../whatsapp/whapi";
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
    /** Для индикатора в меню: умный режим помощника и WhatsApp подключены. */
    system: { smartAssistant: (await secretInfo("openai")).set, whatsapp: (await secretInfo("whapi")).set },
  };
}

function maskPhone(phone: string): string {
  const digits = phone.replaceAll(/\D/g, "");
  return digits.length > 4 ? `+${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : phone;
}

// ---------- Настройки системы ----------

/** Вкладка «Компания». */
export async function getSystemSettings(actor: Actor) {
  assertDirector(actor);
  return {
    name: actor.company.name,
    timezone: actor.company.timezone,
    accent: actor.settings.accent,
    logoUrl: actor.settings.logoUrl,
    workDays: actor.settings.workDays,
    acceptanceEnabled: actor.settings.acceptanceEnabled,
    employeeSeesColleagues: actor.settings.employeeSeesColleagues,
  };
}

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1, "required").max(120, "too_long"),
  timezone: z.string().trim().refine(isValidTimeZone, "timezone_invalid"),
  accent: companySettingsSchema.shape.accent,
  workDays: companySettingsSchema.shape.workDays,
  acceptanceEnabled: z.boolean(),
  employeeSeesColleagues: z.boolean(),
});

/** Название, оформление, часовой пояс, рабочие дни и правила работы с задачами. */
export async function updateCompany(actor: Actor, input: z.infer<typeof updateCompanySchema>) {
  assertDirector(actor);
  const db = getDb();
  await db.update(schema.companies).set({ name: input.name, timezone: input.timezone, updatedAt: Date.now() }).where(eq(schema.companies.id, actor.company.id));
  const settings = await saveSettings(
    actor.company.id,
    { accent: input.accent, workDays: input.workDays, acceptanceEnabled: input.acceptanceEnabled, employeeSeesColleagues: input.employeeSeesColleagues },
    actor.user.id,
  );
  if (input.acceptanceEnabled !== actor.settings.acceptanceEnabled) await seedWorkflow(actor.company.id, input.acceptanceEnabled);
  // Сменился часовой пояс — сроки открытых задач пересчитываются.
  if (input.timezone !== actor.company.timezone) {
    const open = await db
      .select({ id: schema.tasks.id, dueDate: schema.tasks.dueDate, dueTime: schema.tasks.dueTime })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.companyId, actor.company.id), isNotNull(schema.tasks.dueDate), isNull(schema.tasks.completedAt)));
    for (const t of open) {
      await db.update(schema.tasks).set({ dueAt: dueMomentInZone(t.dueDate!, t.dueTime ?? settings.dueTime, input.timezone) }).where(eq(schema.tasks.id, t.id));
    }
  }
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "company.updated" });
  return { ok: true };
}

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Логотип загружается файлом (до 1 МБ) и хранится в файловом хранилище. */
export async function uploadLogo(actor: Actor, file: File | null) {
  assertDirector(actor);
  const bucket = getEnv().BUCKET;
  if (!bucket) throw new AppError("files_unavailable", 503);
  if (!file) {
    await bucket.delete("branding/logo").catch(() => {});
    await saveSettings(actor.company.id, { logoUrl: "" }, actor.user.id);
    return { logoUrl: "" };
  }
  if (!LOGO_TYPES.has(file.type)) throw new AppError("logo_type", 400);
  if (file.size > 1024 * 1024) throw new AppError("logo_too_large", 413);
  await bucket.put("branding/logo", await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const logoUrl = `/api/branding/logo?v=${Date.now()}`;
  await saveSettings(actor.company.id, { logoUrl }, actor.user.id);
  return { logoUrl };
}

/** Логотип публичный: он виден и на странице входа. */
export async function logoResponse(): Promise<Response> {
  const object = await getEnv().BUCKET?.get("branding/logo");
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "image/png",
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
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
  const counts = await getDb()
    .select({ branchId: schema.memberships.branchId, n: sql<number>`count(*)` })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.companyId, actor.company.id), isNull(schema.memberships.revokedAt)))
    .groupBy(schema.memberships.branchId);
  return rows.map((r) => ({ id: r.id, name: r.name, members: Number(counts.find((c) => c.branchId === r.id)?.n ?? 0) }));
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
      phone: schema.users.phone,
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
      phone: director && r.phoneVerifiedAt ? r.phone : null,
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
  /** Номер WhatsApp сотрудника, который вводит директор («» — убрать). Бот отвечает только этим номерам. */
  phone: z.string().trim().max(20).optional(),
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
  if (input.phone !== undefined) {
    const phone = input.phone.replaceAll(/\D/g, "");
    if (phone && (phone.length < 10 || phone.length > 15)) throw new AppError("phone_invalid", 400, { fields: { phone: "phone_invalid" } });
    if (phone) {
      // Один номер — один сотрудник.
      await db.update(schema.users).set({ phone: null, phoneVerifiedAt: null }).where(and(eq(schema.users.phone, phone), ne(schema.users.id, userId)));
    }
    await db.update(schema.users).set({ phone: phone || null, phoneVerifiedAt: phone ? now : null, updatedAt: now }).where(eq(schema.users.id, userId));
  }
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

// ---------- WhatsApp и помощник ----------

/** Модели OpenAI, из которых директор выбирает (название и подсказка — в интерфейсе). */
export { ASSISTANT_MODELS };

async function openaiCheck(key: string): Promise<"connected" | "wrong_key" | "unreachable"> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
    if (res.status === 401 || res.status === 403) return "wrong_key";
    return res.ok ? "connected" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/** Настройки WhatsApp-агента и помощника — только директор. Ключи наружу не отдаются. */
export async function getAssistantSettings(actor: Actor) {
  assertDirector(actor);
  const [whapi, openai, health] = await Promise.all([secretInfo("whapi"), secretInfo("openai"), whapiHealth()]);
  const [{ n } = { n: 0 }] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(and(eq(schema.memberships.companyId, actor.company.id), isNull(schema.memberships.revokedAt), isNotNull(schema.users.phoneVerifiedAt)));
  return {
    whatsapp: { set: whapi.set, last4: whapi.last4, status: health.status, number: actor.settings.whapiPhone || health.phone || "" },
    openai: { set: openai.set, last4: openai.last4, status: openai.set ? (openai.status ?? "unchecked") : "not_set" },
    model: actor.settings.assistantModel,
    assistantName: actor.settings.assistantName,
    instructions: actor.settings.assistantInstructions,
    employeesWithPhone: Number(n),
  };
}

export const updateAssistantSchema = z.object({
  /** undefined — не менять; "" — отключить. */
  whapiKey: z.string().trim().max(300).optional(),
  openaiKey: z.string().trim().max(300).optional(),
  model: companySettingsSchema.shape.assistantModel,
  assistantName: companySettingsSchema.shape.assistantName,
  instructions: companySettingsSchema.shape.assistantInstructions,
  number: z.string().trim().max(20).optional(),
});

export async function updateAssistantSettings(actor: Actor, input: z.infer<typeof updateAssistantSchema>, origin: string) {
  assertDirector(actor);
  let number = (input.number ?? actor.settings.whapiPhone).replaceAll(/\D/g, "");

  if (input.whapiKey !== undefined) {
    if (input.whapiKey) {
      const health = await whapiHealth(input.whapiKey);
      if (health.status === "wrong_key") throw new AppError("whapi_key_wrong", 400, { fields: { whapiKey: "whapi_key_wrong" } });
      await saveSecret("whapi", input.whapiKey, actor.user.id);
      // Адрес для входящих сообщений прописывается в Whapi автоматически.
      const key = await webhookKey(input.whapiKey);
      if (key) await registerWebhook(input.whapiKey, `${origin}/api/whapi/webhook/${key}`);
      if (!number && health.phone) number = health.phone;
    } else {
      await saveSecret("whapi", "", actor.user.id);
    }
  }

  if (input.openaiKey !== undefined) {
    if (input.openaiKey) {
      const status = await openaiCheck(input.openaiKey);
      if (status === "wrong_key") throw new AppError("openai_key_wrong", 400, { fields: { openaiKey: "openai_key_wrong" } });
      await saveSecret("openai", input.openaiKey, actor.user.id, { status, checkedAt: Date.now() });
    } else {
      await saveSecret("openai", "", actor.user.id);
    }
  }

  await saveSettings(
    actor.company.id,
    { assistantModel: input.model, assistantName: input.assistantName, assistantInstructions: input.instructions, whapiPhone: number },
    actor.user.id,
  );
  await audit({ companyId: actor.company.id, actorId: actor.user.id, action: "assistant.settings_updated" });
  return getAssistantSettings({ ...actor, settings: { ...actor.settings, assistantModel: input.model, assistantName: input.assistantName, assistantInstructions: input.instructions, whapiPhone: number } });
}
