/**
 * Первый запуск: владелец сайта вводит OWNER_ACTIVATION_CODE (секрет сайта)
 * и получает одноразовое приглашение первого директора (по умолчанию 72 часа).
 */
import { and, eq, isNull } from "drizzle-orm";
import { companyConfig } from "../../config/company";
import { audit } from "../audit";
import { newId, randomToken, sha256Hex, timingSafeEqual } from "../crypto";
import { getDb, schema } from "../db";
import { getEnv } from "../env";
import { AppError } from "../errors";
import { assertNotLocked, clearFailures, registerFailure } from "../throttle";
import { isValidTimeZone } from "../time";

const SETUP_KEY = "setup";

export async function hasActiveDirector(): Promise<boolean> {
  const row = await getDb().query.memberships.findFirst({
    where: and(eq(schema.memberships.role, "director"), isNull(schema.memberships.revokedAt)),
  });
  return Boolean(row);
}

export async function setupStatus() {
  const db = getDb();
  const company = await db.query.companies.findFirst();
  const director = await hasActiveDirector();
  const codeConfigured = Boolean(getEnv().OWNER_ACTIVATION_CODE?.trim());
  return {
    needsSetup: !director,
    companyExists: Boolean(company),
    activationCodeConfigured: codeConfigured,
  };
}

/** Создаёт компанию с настройками по умолчанию: статусы и переходы из config/company.ts. */
export async function createCompany(name: string, timezone: string): Promise<string> {
  const db = getDb();
  const id = newId();
  const now = Date.now();
  await db.insert(schema.companies).values({
    id,
    name,
    timezone,
    locale: companyConfig.locale,
    createdAt: now,
    updatedAt: now,
  });
  await seedWorkflow(id);
  return id;
}

export async function seedWorkflow(companyId: string, acceptanceEnabled = companyConfig.rules.acceptanceEnabled) {
  const db = getDb();
  const statuses = acceptanceEnabled
    ? companyConfig.statuses
    : companyConfig.statuses.filter((s) => s.category !== "review");
  const transitions = acceptanceEnabled ? companyConfig.transitions : companyConfig.transitionsWithoutAcceptance;
  await db.delete(schema.statusTransitions).where(eq(schema.statusTransitions.companyId, companyId));
  for (const [i, s] of statuses.entries()) {
    await db
      .insert(schema.taskStatuses)
      .values({ companyId, key: s.key, name: s.name, sort: i, category: s.category })
      .onConflictDoUpdate({
        target: [schema.taskStatuses.companyId, schema.taskStatuses.key],
        set: { name: s.name, sort: i, category: s.category, archivedAt: null },
      });
  }
  for (const t of transitions) {
    await db.insert(schema.statusTransitions).values({
      companyId,
      fromKey: t.from,
      toKey: t.to,
      actorsJson: JSON.stringify(t.actors),
      requiresJson: JSON.stringify("requires" in t ? (t.requires ?? {}) : {}),
    });
  }
}

export async function issueOwnerInvite(input: { code: string; companyName?: string; timezone?: string }) {
  const expected = getEnv().OWNER_ACTIVATION_CODE?.trim();
  if (!expected) throw new AppError("activation_code_missing", 503);
  if (await hasActiveDirector()) throw new AppError("already_activated", 409);

  await assertNotLocked(SETUP_KEY);
  if (!timingSafeEqual(input.code.trim(), expected)) {
    await registerFailure(SETUP_KEY);
    throw new AppError("activation_code_invalid", 403);
  }
  await clearFailures(SETUP_KEY);

  const db = getDb();
  let company = await db.query.companies.findFirst();
  const timezone = input.timezone && isValidTimeZone(input.timezone) ? input.timezone : companyConfig.timezone;
  if (!company) {
    const id = await createCompany(input.companyName?.trim() || companyConfig.name, timezone);
    company = (await db.query.companies.findFirst({ where: eq(schema.companies.id, id) }))!;
  } else if (input.companyName?.trim()) {
    await db
      .update(schema.companies)
      .set({ name: input.companyName.trim(), updatedAt: Date.now() })
      .where(eq(schema.companies.id, company.id));
  }

  const now = Date.now();
  // Прежние неиспользованные приглашения владельца отзываются: действует только последнее.
  await db
    .update(schema.invitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(schema.invitations.kind, "owner"),
        isNull(schema.invitations.usedAt),
        isNull(schema.invitations.revokedAt),
      ),
    );

  const token = randomToken();
  const expiresAt = now + companyConfig.invitations.ownerTtlHours * 3600_000;
  const id = newId();
  await db.insert(schema.invitations).values({
    id,
    kind: "owner",
    companyId: company.id,
    branchId: null,
    role: "director",
    tokenHash: await sha256Hex(token),
    note: null,
    createdBy: null,
    expiresAt,
    createdAt: now,
  });
  await audit({ companyId: company.id, actorId: null, action: "owner_invite.issued", targetType: "invitation", targetId: id });
  return { token, expiresAt };
}
