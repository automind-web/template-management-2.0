/**
 * Единый серверный слой операций для сайта (а позже — веб-помощника, WhatsApp и плагина директора).
 * Каждая операция получает Actor, загруженный из БД на этот запрос, и сама проверяет права.
 */
import { and, eq } from "drizzle-orm";
import { requireActor, sessionTokenFromRequest, loadActorByToken } from "./context";
import { AppError, notFound } from "./errors";
import { assertSameOrigin, clearSessionCookie, errorResponse, json, publicOrigin, readJson, sessionCookie } from "./http";
import * as auth from "./ops/auth";
import * as invites from "./ops/invites";
import * as org from "./ops/org";
import * as setup from "./ops/setup";
import * as system from "./ops/system";
import * as notify from "./notify/queue";
import { loadPrefs, prefsSchema, savePrefs } from "./notify/prefs";
import { pushKeys } from "./integrations";
import { whapiConfigured } from "./whatsapp/whapi";
import { getDb, schema } from "./db";
import { newId } from "./crypto";
import * as assistant from "./assistant/service";
import * as whatsappInbound from "./whatsapp/inbound";
import * as whatsappLink from "./whatsapp/link";
import * as stats from "./ops/stats";
import * as tasks from "./ops/tasks";
import { resolveBranch } from "./permissions";
import { loadPublicBranding } from "./settings";
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

/** Название и логотип для страниц входа (без данных пользователей). */
route("GET", "/api/branding", async () => {
  const b = await loadPublicBranding();
  return json({ name: b.name, logoUrl: b.logoUrl });
});

// ---------- Первый запуск ----------

route("GET", "/api/setup/status", async () => json(await setup.setupStatus()));

route("POST", "/api/setup/owner-invite", async ({ request }) => {
  const input = await readJson(
    request,
    z.object({
      code: z.string().min(1, "required").max(200),
      companyName: z.string().trim().max(120).optional(),
      timezone: z.string().trim().max(64).optional(),
      ttlHours: z.number().int().min(1, "ttl_invalid").max(720, "ttl_invalid").optional(),
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

route("POST", "/api/auth/recover/request", async ({ request }) => {
  const input = await readJson(request, z.object({ login: z.string().trim().toLowerCase().min(1, "required").max(40) }));
  return json(await auth.requestRecoveryCode(input.login));
});

route("POST", "/api/auth/recover", async ({ request }) => {
  const input = await readJson(request, auth.recoverSchema);
  return json(await auth.recoverPassword(input));
});

route("GET", "/api/auth/reset", async ({ url }) => json(await auth.checkResetLink(url.searchParams.get("token") ?? "")));

route("POST", "/api/auth/reset", async ({ request }) => {
  const input = await readJson(request, auth.resetByLinkSchema);
  return json(await auth.resetByLink(input));
});

// ---------- Приглашения ----------

route("GET", "/api/invites/lookup", async ({ url }) => json(await invites.lookupInvite(url.searchParams.get("token") ?? "")));

route("POST", "/api/invites/accept", async ({ request }) => {
  const input = await readJson(request, invites.acceptInviteSchema);
  const { token } = await invites.acceptInvite(input, ua(request));
  return json({ ok: true }, { headers: loginCookie(request, token) });
});

route("POST", "/api/invites/accept-existing", async ({ request }) => {
  const input = await readJson(request, invites.acceptExistingSchema);
  const { token } = await invites.acceptInviteExisting(input, ua(request));
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

route("GET", "/api/settings", async ({ request }) => json(await org.getSystemSettings(await requireActor(request))));

route("PATCH", "/api/settings/company", async ({ request }) => {
  const actor = await requireActor(request);
  return json(await org.updateCompany(actor, await readJson(request, org.updateCompanySchema)));
});

route("POST", "/api/settings/logo", async ({ request }) => {
  const actor = await requireActor(request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("bad_form", 400);
  }
  const file = form.get("file");
  return json(await org.uploadLogo(actor, file instanceof File ? file : null));
});

route("DELETE", "/api/settings/logo", async ({ request }) => json(await org.uploadLogo(await requireActor(request), null)));

route("GET", "/api/branding/logo", async () => org.logoResponse());

route("GET", "/api/settings/assistant", async ({ request }) => json(await org.getAssistantSettings(await requireActor(request))));

route("PATCH", "/api/settings/assistant", async ({ request }) => {
  const actor = await requireActor(request);
  return json(await org.updateAssistantSettings(actor, await readJson(request, org.updateAssistantSchema), publicOrigin(request)));
});

route("GET", "/api/branches", async ({ request }) => json({ branches: await org.listBranches(await requireActor(request)) }));

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

route("POST", "/api/members/:userId/reset-link", async ({ request, params }) => {
  const r = await auth.issueResetLink(await requireActor(request), params.userId!);
  return json({ resetUrl: `${publicOrigin(request)}/reset/${r.token}`, expiresAt: r.expiresAt });
});

// ---------- Задачи ----------

/** После изменения возвращается актуальная карточка: фактический статус и следующее действие. */
const cardAfter = async (request: Request, r: { taskId: string; replayed?: boolean }) => {
  const actor = await requireActor(request);
  return json({ ...(await tasks.getTaskCard(actor, r.taskId)), replayed: Boolean(r.replayed) });
};

route("GET", "/api/tasks", async ({ request, url }) =>
  json(await tasks.listTasks(await requireActor(request), tasks.parseListQuery(url))),
);

route("POST", "/api/tasks", async ({ request }) => {
  const actor = await requireActor(request);
  const r = await tasks.createTask(actor, await readJson(request, tasks.createTaskSchema));
  const card = await tasks.getTaskCard(actor, r.taskId);
  return json({ ...card, replayed: Boolean(r.replayed) }, { status: r.replayed ? 200 : 201 });
});

route("GET", "/api/tasks/assignees", async ({ request, url }) => {
  const actor = await requireActor(request);
  const branch = url.searchParams.get("branch");
  const scope = branch === "all" ? "all" : resolveBranch(actor, branch);
  return json({ assignees: await tasks.searchAssignees(actor, scope, url.searchParams.get("q") ?? "") });
});

route("GET", "/api/tasks/:id", async ({ request, params }) => json(await tasks.getTaskCard(await requireActor(request), params.id!)));

route("PATCH", "/api/tasks/:id", async ({ request, params }) => {
  const actor = await requireActor(request);
  return cardAfter(request, await tasks.updateTask(actor, params.id!, await readJson(request, tasks.updateTaskSchema)));
});

route("POST", "/api/tasks/:id/status", async ({ request, params }) => {
  const actor = await requireActor(request);
  return cardAfter(request, await tasks.changeStatus(actor, params.id!, await readJson(request, tasks.changeStatusSchema)));
});

route("POST", "/api/tasks/:id/cancel", async ({ request, params }) => {
  const actor = await requireActor(request);
  return cardAfter(request, await tasks.setCancelled(actor, params.id!, true, await readJson(request, tasks.cancelSchema)));
});

route("POST", "/api/tasks/:id/restore", async ({ request, params }) => {
  const actor = await requireActor(request);
  return cardAfter(request, await tasks.setCancelled(actor, params.id!, false, await readJson(request, tasks.cancelSchema)));
});

route("POST", "/api/tasks/:id/comments", async ({ request, params }) => {
  const actor = await requireActor(request);
  return cardAfter(request, await tasks.addComment(actor, params.id!, await readJson(request, tasks.commentSchema)));
});

route("POST", "/api/tasks/:id/attachments", async ({ request, params }) => {
  const actor = await requireActor(request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("bad_form", 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("file_empty", 400);
  await tasks.uploadAttachment(actor, params.id!, file, String(form.get("kind") ?? "file"));
  return cardAfter(request, { taskId: params.id! });
});

route("GET", "/api/attachments/:id", async ({ request, params }) =>
  tasks.downloadAttachment(await requireActor(request), params.id!),
);

route("DELETE", "/api/attachments/:id", async ({ request, params }) =>
  json(await tasks.deleteAttachment(await requireActor(request), params.id!)),
);

// ---------- Уведомления и push ----------

route("GET", "/api/notifications", async ({ request }) => {
  const actor = await requireActor(request);
  const push = await pushKeys();
  return json({
    ...(await notify.inbox(actor)),
    prefs: await loadPrefs(actor.user.id),
    workDays: actor.settings.workDays,
    channels: {
      whatsapp: { linked: Boolean(actor.user.phoneVerifiedAt), configured: await whapiConfigured() },
      push: { configured: Boolean(push), vapidPublicKey: push?.publicKey ?? null },
    },
  });
});

route("GET", "/api/notifications/count", async ({ request }) => json({ unread: await notify.unreadCount(await requireActor(request)) }));

route("POST", "/api/notifications/read", async ({ request }) => {
  const actor = await requireActor(request);
  const input = await readJson(request, z.object({ ids: z.array(z.string().max(80)).max(100).optional(), all: z.boolean().optional() }));
  return json(await notify.markRead(actor, input.all ? "all" : (input.ids ?? [])));
});

route("PATCH", "/api/notifications/prefs", async ({ request }) => {
  const actor = await requireActor(request);
  const prefs = await readJson(request, prefsSchema);
  await savePrefs(actor.user.id, prefs);
  await notify.afterPrefsChange(actor);
  return json({ ok: true });
});

/** Подписка push привязана к сессии: после выхода доставка на это устройство прекращается. */
route("POST", "/api/push/subscribe", async ({ request }) => {
  const actor = await requireActor(request);
  const input = await readJson(
    request,
    z.object({
      endpoint: z.string().url().startsWith("https://").max(1000),
      keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
    }),
  );
  const now = Date.now();
  await getDb()
    .insert(schema.pushSubscriptions)
    .values({ id: newId(), userId: actor.user.id, sessionId: actor.session.id, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, createdAt: now })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId: actor.user.id, sessionId: actor.session.id, p256dh: input.keys.p256dh, auth: input.keys.auth, revokedAt: null },
    });
  return json({ ok: true });
});

route("POST", "/api/push/unsubscribe", async ({ request }) => {
  const actor = await requireActor(request);
  const input = await readJson(request, z.object({ endpoint: z.string().max(1000) }));
  await getDb()
    .update(schema.pushSubscriptions)
    .set({ revokedAt: Date.now() })
    .where(and(eq(schema.pushSubscriptions.endpoint, input.endpoint), eq(schema.pushSubscriptions.userId, actor.user.id)));
  return json({ ok: true });
});

// ---------- WhatsApp ----------

route("POST", "/api/me/phone/code", async ({ request }) => json(await whatsappLink.issueLinkCode(await requireActor(request))));

route("DELETE", "/api/me/phone", async ({ request }) => json(await whatsappLink.unlinkPhone(await requireActor(request))));

/** Вебхук Whapi: адрес с ключом из «Подключений». Сессия не нужна, origin не проверяется (сервер-сервер). */
route("POST", "/api/whapi/webhook/:key", async ({ request, params }) => json(await whatsappInbound.handleWebhook(params.key!, request)));

// ---------- Помощник ----------

route("GET", "/api/assistant", async ({ request }) => json(await assistant.getChat(await requireActor(request))));

route("POST", "/api/assistant/message", async ({ request }) => {
  const actor = await requireActor(request);
  const input = await readJson(request, z.object({ text: z.string().trim().min(1, "required").max(4000), opId: z.string().min(8).max(80).optional() }));
  return json(await assistant.sendWebMessage(actor, input.text, input.opId));
});

route("POST", "/api/assistant/voice", async ({ request }) => {
  const actor = await requireActor(request);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new AppError("bad_form", 400);
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) throw new AppError("file_empty", 400);
  return json({ messages: (await assistant.sendVoice(actor, audio)).messages });
});

route("DELETE", "/api/assistant", async ({ request }) => json(await assistant.clearChat(await requireActor(request))));

// ---------- Статистика ----------

route("GET", "/api/stats", async ({ request, url }) => json(await stats.getStats(await requireActor(request), stats.parseStatsQuery(url))));

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
    if (error instanceof AppError && error.code === "version_conflict") {
      const m = /^\/api\/tasks\/([^/]+)/.exec(url.pathname);
      if (m) {
        try {
          const current = await tasks.getTaskCard(await requireActor(request), decodeURIComponent(m[1]!));
          return json({ error: { code: error.code, details: { current } } }, { status: 409 });
        } catch {
          /* нет доступа — обычный ответ об ошибке */
        }
      }
    }
    const response = errorResponse(error);
    // Сессия недействительна или доступ отозван — cookie сбрасывается.
    if (error instanceof AppError && (error.code === "unauthorized" || error.code === "access_revoked")) {
      response.headers.append("set-cookie", clearSessionCookie(request));
    }
    return response;
  }
}
