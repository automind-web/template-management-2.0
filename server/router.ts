/**
 * Единый серверный слой операций для сайта (а позже — веб-помощника, WhatsApp и плагина директора).
 * Каждая операция получает Actor, загруженный из БД на этот запрос, и сама проверяет права.
 */
import { requireActor, sessionTokenFromRequest, loadActorByToken } from "./context";
import { AppError, notFound } from "./errors";
import { assertSameOrigin, clearSessionCookie, errorResponse, json, publicOrigin, readJson, sessionCookie } from "./http";
import * as auth from "./ops/auth";
import * as invites from "./ops/invites";
import * as org from "./ops/org";
import * as setup from "./ops/setup";
import * as system from "./ops/system";
import { sessionTtlMs } from "./session";
import { z } from "zod";

type Ctx = { request: Request; url: URL; params: Record<string, string> };
type Handler = (ctx: Ctx) => Promise<Response>;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
        keys.push(k);
        return "([^/]+)";
      }) +
      "$",
  );
  routes.push({ method, pattern, keys, handler });
}

const ua = (r: Request) => r.headers.get("user-agent");
const loginCookie = (request: Request, token: string) =>
  ({ "set-cookie": sessionCookie(request, token, Math.floor(sessionTtlMs() / 1000)) }) as const;

// ---------- Служебное ----------

route("GET", "/api/health", async () => json(await system.health()));

// ---------- Первый запуск ----------

route("GET", "/api/setup/status", async () => json(await setup.setupStatus()));

route("POST", "/api/setup/owner-invite", async ({ request }) => {
  const input = await readJson(
    request,
    z.object({
      code: z.string().min(1, "required").max(200),
      companyName: z.string().trim().max(120).optional(),
      timezone: z.string().trim().max(64).optional(),
    }),
  );
  const result = await setup.issueOwnerInvite(input);
  return json({ inviteUrl: `${publicOrigin(request)}/invite/${result.token}`, expiresAt: result.expiresAt });
});

// ---------- Вход ----------

route("POST", "/api/auth/login", async ({ request }) => {
  const input = await readJson(request, auth.loginInputSchema);
  const { token } = await auth.login(input, ua(request));
  return json({ ok: true }, { headers: loginCookie(request, token) });
});

route("POST", "/api/auth/logout", async ({ request }) => {
  const actor = await loadActorByToken(sessionTokenFromRequest(request)).catch(() => null);
  if (actor) await auth.logout(actor);
  return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie(request) } });
});

route("POST", "/api/auth/recover", async ({ request }) => {
  const input = await readJson(request, auth.recoverSchema);
  return json(await auth.recoverPassword(input));
});

// ---------- Приглашения ----------

route("GET", "/api/invites/lookup", async ({ url }) => json(await invites.lookupInvite(url.searchParams.get("token") ?? "")));

route("POST", "/api/invites/accept", async ({ request }) => {
  const input = await readJson(request, invites.acceptInviteSchema);
  const { token } = await invites.acceptInvite(input, ua(request));
  return json({ ok: true }, { headers: loginCookie(request, token) });
});

route("GET", "/api/invites", async ({ request }) => json({ invites: await invites.listInvites(await requireActor(request)) }));

route("POST", "/api/invites", async ({ request }) => {
  const actor = await requireActor(request);
  const input = await readJson(request, invites.createInviteSchema);
  const result = await invites.createInvite(actor, input);
  return json({ id: result.id, inviteUrl: `${publicOrigin(request)}/invite/${result.token}`, expiresAt: result.expiresAt });
});

route("DELETE", "/api/invites/:id", async ({ request, params }) =>
  json(await invites.revokeInvite(await requireActor(request), params.id!)),
);

// ---------- Профиль ----------

route("GET", "/api/me", async ({ request }) => json(await org.me(await requireActor(request))));

route("PATCH", "/api/me", async ({ request }) => {
  const actor = await requireActor(request);
  return json(await auth.updateProfile(actor, await readJson(request, auth.updateProfileSchema)));
});

route("POST", "/api/me/password", async ({ request }) => {
  const actor = await requireActor(request);
  return json(await auth.changePassword(actor, await readJson(request, auth.changePasswordSchema)));
});

route("GET", "/api/me/sessions", async ({ request }) => json({ sessions: await auth.listSessions(await requireActor(request)) }));

route("DELETE", "/api/me/sessions/:id", async ({ request, params }) => {
  const result = await auth.revokeOwnSession(await requireActor(request), params.id!);
  return json(result, result.current ? { headers: { "set-cookie": clearSessionCookie(request) } } : {});
});

// ---------- Компания, филиалы, участники ----------

route("PATCH", "/api/company", async ({ request }) => {
  const actor = await requireActor(request);
  return json(await org.updateCompany(actor, await readJson(request, org.updateCompanySchema)));
});

route("GET", "/api/branches", async ({ request, url }) =>
  json({ branches: await org.listBranches(await requireActor(request), url.searchParams.get("archived") === "1") }),
);

route("POST", "/api/branches", async ({ request }) => {
  const actor = await requireActor(request);
  return json(await org.createBranch(actor, await readJson(request, org.branchSchema)), { status: 201 });
});

route("PATCH", "/api/branches/:id", async ({ request, params }) => {
  const actor = await requireActor(request);
  return json(await org.renameBranch(actor, params.id!, await readJson(request, org.branchSchema)));
});

route("DELETE", "/api/branches/:id", async ({ request, params }) =>
  json(await org.archiveBranch(await requireActor(request), params.id!)),
);

route("GET", "/api/members", async ({ request, url }) =>
  json({ members: await org.listMembers(await requireActor(request), url.searchParams.get("branch")) }),
);

route("PATCH", "/api/members/:userId", async ({ request, params }) => {
  const actor = await requireActor(request);
  return json(await org.updateMember(actor, params.userId!, await readJson(request, org.updateMemberSchema)));
});

route("DELETE", "/api/members/:userId", async ({ request, params }) =>
  json(await org.revokeMember(await requireActor(request), params.userId!)),
);

route("POST", "/api/members/:userId/reset-code", async ({ request, params }) =>
  json(await auth.issueResetCode(await requireActor(request), params.userId!)),
);

route("GET", "/api/system/status", async ({ request }) => json(await system.systemStatus(await requireActor(request))));

// ---------- Диспетчер ----------

export async function dispatch(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  try {
    assertSameOrigin(request);
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      if (r.method !== method) {
        methodMismatch = true;
        continue;
      }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1]!)));
      const response = await r.handler({ request, url, params });
      return response;
    }
    if (methodMismatch) throw new AppError("method_not_allowed", 405);
    throw notFound();
  } catch (error) {
    const response = errorResponse(error);
    // Сессия недействительна или доступ отозван — cookie сбрасывается.
    if (error instanceof AppError && (error.code === "unauthorized" || error.code === "access_revoked")) {
      response.headers.append("set-cookie", clearSessionCookie(request));
    }
    return response;
  }
}
