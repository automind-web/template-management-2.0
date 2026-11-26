import { and, asc, eq, isNull } from "drizzle-orm";
import type { Role } from "../db/schema";
import { getDb, schema } from "./db";
import { AppError, unauthorized } from "./errors";
import { parseCookies, SESSION_COOKIE } from "./http";
import { findSession, type SessionRow } from "./session";

export type BranchRef = { id: string; name: string };

/**
 * Участник, от имени которого выполняется операция.
 * Загружается из БД на КАЖДЫЙ запрос — перевод или отзыв роли действует сразу.
 */
export type Actor = {
  user: { id: string; login: string; displayName: string; phone: string | null; phoneVerifiedAt: number | null };
  session: SessionRow;
  membership: { id: string; role: Role; branchId: string | null; position: string | null };
  company: { id: string; name: string; timezone: string; locale: string };
  /** Филиалы, доступные участнику (директор — все активные филиалы компании). */
  branches: BranchRef[];
  channel: "web" | "whatsapp" | "plugin";
};

export async function loadActorByToken(token: string | null | undefined): Promise<Actor | null> {
  const session = await findSession(token);
  if (!session) return null;
  return loadActorForSession(session);
}

export async function loadActorForSession(session: SessionRow): Promise<Actor | null> {
  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, session.userId) });
  if (!user || user.disabledAt) return null;
  const membership = await db.query.memberships.findFirst({
    where: and(eq(schema.memberships.userId, user.id), isNull(schema.memberships.revokedAt)),
  });
  if (!membership) throw new AppError("access_revoked", 403);
  const company = await db.query.companies.findFirst({ where: eq(schema.companies.id, membership.companyId) });
  if (!company) throw new AppError("access_revoked", 403);

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
    },
    company: { id: company.id, name: company.name, timezone: company.timezone, locale: company.locale },
    branches,
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
