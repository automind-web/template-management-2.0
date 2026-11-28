import { and, asc, eq, isNull } from "drizzle-orm";
import type { Role } from "../db/schema";
import { getDb, schema } from "./db";
import { AppError, unauthorized } from "./errors";
import { parseCookies, SESSION_COOKIE } from "./http";
import { findSession, type SessionRow } from "./session";
import { loadSettings, type CompanySettings } from "./settings";

export type BranchRef = { id: string; name: string };

/**
 * Участник, от имени которого выполняется операция.
 * Загружается из БД на КАЖДЫЙ запрос — перевод или отзыв роли действует сразу.
 */
export type Actor = {
  user: { id: string; login: string; displayName: string; phone: string | null; phoneVerifiedAt: number | null };
  session: SessionRow;
  membership: { id: string; role: Role; branchId: string | null; position: string | null; canInvite: boolean };
  company: { id: string; name: string; timezone: string; locale: string };
  /** Филиалы, доступные участнику (директор — все активные филиалы компании). */
  branches: BranchRef[];
  /** Настройки компании на момент запроса (видимость, приёмка, срок по умолчанию). */
  settings: CompanySettings;
  channel: "web" | "whatsapp" | "plugin";
};

export async function loadActorByToken(token: string | null | undefined): Promise<Actor | null> {
  const session = await findSession(token);
  if (!session) return null;
  return loadActorForSession(session);
}

export async function loadActorForSession(session: SessionRow): Promise<Actor | null> {
  const db = getDb();
  const [user, links] = await Promise.all([
    db.query.users.findFirst({ where: eq(schema.users.id, session.userId) }),
    db.select({ membership: schema.memberships, company: schema.companies })
      .from(schema.memberships)
      .innerJoin(schema.companies, eq(schema.companies.id, schema.memberships.companyId))
      .where(and(eq(schema.memberships.userId, session.userId), isNull(schema.memberships.revokedAt)))
      .limit(1),
  ]);
  if (!user || user.disabledAt) return null;
  const link = links[0];
  if (!link) throw new AppError("access_revoked", 403);
  const { membership, company } = link;
  const settingsPromise = loadSettings(company.id);

  let branches: BranchRef[];
  if (membership.role === "director") {
    branches = await db
      .select({ id: schema.branches.id, name: schema.branches.name })
      .from(schema.branches)
      .where(and(eq(schema.branches.companyId, company.id), isNull(schema.branches.archivedAt)))
      .orderBy(asc(schema.branches.name));
  } else {
    if (!membership.branchId) throw new AppError("access_revoked", 403);
    const branch = await db.query.branches.findFirst({
      where: and(eq(schema.branches.id, membership.branchId), eq(schema.branches.companyId, company.id)),
    });
    if (!branch || branch.archivedAt) throw new AppError("access_revoked", 403);
    branches = [{ id: branch.id, name: branch.name }];
  }

  return {
    user: {
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      phone: user.phone,
      phoneVerifiedAt: user.phoneVerifiedAt,
    },
    session,
    membership: {
      id: membership.id,
      role: membership.role,
      branchId: membership.branchId,
      position: membership.position,
      canInvite: membership.canInvite,
    },
    company: { id: company.id, name: company.name, timezone: company.timezone, locale: company.locale },
    branches,
    settings: await settingsPromise,
    channel: "web",
  };
}

export function sessionTokenFromRequest(request: Request): string | undefined {
  return parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
}

export async function requireActor(request: Request): Promise<Actor> {
  const actor = await loadActorByToken(sessionTokenFromRequest(request));
  if (!actor) throw unauthorized();
  return actor;
}

/**
 * Участник без веб-сессии: фоновая доставка уведомлений, WhatsApp.
 * Права читаются из БД так же, как для сайта. null — доступа нет.
 */
export async function loadActorForUser(userId: string, channel: Actor["channel"]): Promise<Actor | null> {
  const now = Date.now();
  const session: SessionRow = { id: "", tokenHash: "", userId, userAgent: null, createdAt: now, lastSeenAt: now, expiresAt: now, revokedAt: null };
  try {
    const actor = await loadActorForSession(session);
    return actor ? { ...actor, channel } : null;
  } catch {
    return null;
  }
}
