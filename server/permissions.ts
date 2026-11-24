/**
 * Проверка прав. Все операции вызывают эти функции ДО чтения или изменения записи.
 * Сервер сначала ограничивает данные правами пользователя, потом считает.
 */
import { companyConfig } from "../config/company";
import type { Role } from "../db/schema";
import type { Actor } from "./context";
import { AppError, forbidden } from "./errors";

export const ROLE_RANK: Record<Role, number> = { employee: 1, manager: 2, director: 3 };

export function isDirector(actor: Actor): boolean {
  return actor.membership.role === "director";
}

export function isManager(actor: Actor): boolean {
  return actor.membership.role === "manager";
}

export function canAccessBranch(actor: Actor, branchId: string): boolean {
  return actor.branches.some((b) => b.id === branchId);
}

export function assertBranchAccess(actor: Actor, branchId: string): void {
  if (!canAccessBranch(actor, branchId)) throw new AppError("branch_forbidden", 403);
}

/**
 * Филиал для операции. Директор передаёт выбранный филиал явно;
 * у сотрудника и руководителя он всегда свой. Если филиал один — выбирается сам.
 */
export function resolveBranch(actor: Actor, requested: string | null | undefined): string {
  if (requested) {
    assertBranchAccess(actor, requested);
    return requested;
  }
  if (actor.branches.length === 1) return actor.branches[0]!.id;
  if (actor.branches.length === 0) throw new AppError("no_branches", 409);
  throw new AppError("branch_required", 400);
}

/** Список филиалов, в пределах которых действует запрос ("all" — только для директора). */
export function resolveBranchScope(actor: Actor, requested: string | null | undefined): string[] {
  if (!requested || requested === "all") return actor.branches.map((b) => b.id);
  assertBranchAccess(actor, requested);
  return [requested];
}

export function assertDirector(actor: Actor): void {
  if (!isDirector(actor)) throw forbidden();
}

export function assertManagerOrDirector(actor: Actor): void {
  if (!isDirector(actor) && !isManager(actor)) throw forbidden();
}

/** Кого и в какой филиал участник может пригласить. */
export function assertCanInvite(actor: Actor, role: Role, branchId: string | null): void {
  if (role === "director") throw forbidden("invite_role_forbidden");
  if (!branchId) throw new AppError("branch_required", 400);
  if (isDirector(actor)) {
    assertBranchAccess(actor, branchId);
    return;
  }
  if (isManager(actor) && companyConfig.invitations.managerCanInviteEmployees && role === "employee") {
    if (actor.membership.branchId !== branchId) throw new AppError("branch_forbidden", 403);
    return;
  }
  throw forbidden("invite_role_forbidden");
}

/** Может ли участник управлять членством (роль, филиал, отзыв) другого участника. */
export function assertCanManageMember(actor: Actor, target: { userId: string; role: Role; branchId: string | null }): void {
  if (target.userId === actor.user.id) throw forbidden("cannot_manage_self");
  if (!isDirector(actor)) throw forbidden();
  if (target.role === "director") throw forbidden("cannot_manage_director");
}

/** Флаги для интерфейса. Сервер всё равно проверяет каждое действие. */
export function capabilities(actor: Actor) {
  const director = isDirector(actor);
  const manager = isManager(actor);
  return {
    manageBranches: director,
    manageCompany: director,
    manageIntegrations: director,
    manageMembers: director,
    inviteManagers: director,
    inviteEmployees: director || (manager && companyConfig.invitations.managerCanInviteEmployees),
    viewStats: director || manager,
    viewSystemSettings: director || manager,
    switchBranch: director,
    assignOthers: director || manager,
    acceptResults: director || manager,
  };
}

export type Capabilities = ReturnType<typeof capabilities>;
