// Сквозная проверка этапа 1 на запущенном сервере (локально или на тестовом окружении).
// Запуск: BASE_URL=http://localhost:5173 OWNER_ACTIVATION_CODE=... npm run smoke
// ВНИМАНИЕ: создаёт данные. Только на чистой тестовой БД, не на рабочем сайте.
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:5173";
const CODE = process.env.OWNER_ACTIVATION_CODE ?? "local-dev-code-123";
const origin = new URL(BASE).origin;
const suffix = Date.now().toString(36);

function client() {
  let cookie = "";
  return async function call(method, path, body, extraHeaders = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const m = /am_sid=([^;]*)/.exec(setCookie);
      if (m) cookie = m[1] ? `am_sid=${m[1]}` : "";
    }
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  };
}

const step = (name) => console.log(`• ${name}`);
const tokenOf = (url) => url.split("/invite/")[1];

const anon = client();
const director = client();
const manager = client();
const employee = client();
const manager2 = client();

step("Чистый браузер: / ведёт на форму входа, кабинет закрыт");
let r = await anon("GET", "/");
assert.ok([302, 303, 307, 308].includes(r.status), `ожидался редирект, получено ${r.status}`);
assert.match(r.headers.get("location") ?? "", /\/login/);
r = await anon("GET", "/login");
assert.equal(r.status, 200);
r = await anon("GET", "/api/me");
assert.equal(r.status, 401);

step("Неверный код активации отклоняется");
r = await anon("POST", "/api/setup/owner-invite", { code: "wrong" });
assert.equal(r.status, 403);

step("Приглашение владельца → активация директора (один раз)");
r = await anon("POST", "/api/setup/owner-invite", { code: CODE, companyName: "Тестовая компания" });
assert.equal(r.status, 200, JSON.stringify(r.data));
const ownerToken = tokenOf(r.data.inviteUrl);
r = await anon("GET", `/api/invites/lookup?token=${ownerToken}`);
assert.equal(r.data.valid, true);
assert.equal(r.data.role, "director");
r = await director("POST", "/api/invites/accept", { token: ownerToken, login: "x", displayName: "Д", password: "short" });
assert.equal(r.status, 400, "ошибка формы");
r = await anon("GET", `/api/invites/lookup?token=${ownerToken}`);
assert.equal(r.data.valid, true, "ошибка в форме не гасит приглашение");
r = await director("POST", "/api/invites/accept", {
  token: ownerToken,
  login: `dir-${suffix}`,
  displayName: "Директор Тестов",
  password: "director-pass-1",
});
assert.equal(r.status, 200, JSON.stringify(r.data));
r = await anon("POST", "/api/invites/accept", { token: ownerToken, login: `dir2-${suffix}`, displayName: "X", password: "director-pass-1" });
assert.equal(r.status, 410, "повторно приглашение не используется");
r = await anon("POST", "/api/setup/owner-invite", { code: CODE });
assert.equal(r.status, 409, "после активации setup закрыт");

step("Директор без филиалов видит пустой список, создаёт два филиала");
r = await director("GET", "/api/me");
assert.equal(r.data.role, "director");
assert.equal(r.data.branches.length, 0);
r = await director("POST", "/api/branches", { name: "Алматы, Абая 10" });
assert.equal(r.status, 201);
const b1 = r.data.id;
r = await director("POST", "/api/branches", { name: "Астана" });
const b2 = r.data.id;
r = await director("POST", "/api/branches", { name: "астана" });
assert.equal(r.status, 409, "дубликат названия");

step("Приглашения: руководитель филиала 1, сотрудник филиала 1, руководитель филиала 2");
r = await director("POST", "/api/invites", { role: "manager", branchId: b1 });
const mInv = tokenOf(r.data.inviteUrl);
r = await director("POST", "/api/invites", { role: "employee", branchId: b1 });
const eInv = tokenOf(r.data.inviteUrl);
r = await director("POST", "/api/invites", { role: "manager", branchId: b2 });
const m2Inv = tokenOf(r.data.inviteUrl);
r = await director("POST", "/api/invites", { role: "director", branchId: b1 });
assert.equal(r.status, 400, "директора по приглашению не создать");
r = await director("GET", "/api/settings");
assert.equal(r.status, 200);
r = await director("PATCH", "/api/settings/company", { ...r.data, logoUrl: undefined, acceptanceEnabled: true, employeeSeesColleagues: false });
assert.equal(r.status, 200, JSON.stringify(r.data));

r = await manager("POST", "/api/invites/accept", { token: mInv, login: `mgr-${suffix}`, displayName: "Руководитель Один", password: "manager-pass-1" });
assert.equal(r.status, 200);
r = await employee("POST", "/api/invites/accept", { token: eInv, login: `dir-${suffix}`, displayName: "Сотрудник", password: "employee-pass-1" });
assert.equal(r.status, 409, "занятый логин");
r = await employee("POST", "/api/invites/accept", { token: eInv, login: `emp-${suffix}`, displayName: "Сотрудник Длинное-Имя Фамилия", password: "employee-pass-1" });
assert.equal(r.status, 200, "после ошибки приглашение действует");
r = await manager2("POST", "/api/invites/accept", { token: m2Inv, login: `mgr2-${suffix}`, displayName: "Руководитель Два", password: "manager-pass-2" });
assert.equal(r.status, 200);

step("Вход по своим данным");
const empLogin = client();
r = await empLogin("POST", "/api/auth/login", { login: `emp-${suffix}`, password: "wrong-password" });
assert.equal(r.status, 401);
r = await empLogin("POST", "/api/auth/login", { login: `EMP-${suffix}`, password: "employee-pass-1" });
assert.equal(r.status, 200);
r = await empLogin("GET", "/api/me");
assert.equal(r.data.role, "employee");
assert.equal(r.data.branch.id, b1);

step("Изоляция: руководитель филиала 2 не видит филиал 1");
r = await manager2("GET", `/api/members?branch=${b1}`);
assert.equal(r.status, 403);
r = await manager2("GET", "/api/members?branch=all");
assert.ok(r.data.members.every((m) => m.branchId === b2));
r = await manager2("POST", "/api/invites", { role: "employee", branchId: b1 });
assert.equal(r.status, 403);
r = await manager2("POST", "/api/invites", { role: "manager", branchId: b2 });
assert.equal(r.status, 403, "руководитель не приглашает руководителей");
r = await manager2("POST", "/api/branches", { name: "Чужой" });
assert.equal(r.status, 403);
r = await manager("GET", "/api/invites");
assert.ok(r.data.invites.every((i) => i.branchId === b1));
r = await employee("GET", "/api/members?branch=all");
assert.equal(r.data.members.length, 1, "сотрудник видит только себя");

step("CSRF: запрос с чужого origin отклоняется");
r = await director("POST", "/api/branches", { name: "CSRF" }, { origin: "https://evil.example" });
assert.equal(r.status, 403);

step("Перевод: сотрудник → филиал 2 действует со следующего запроса");
const empId = (await employee("GET", "/api/me")).data.user.id;
r = await director("PATCH", `/api/members/${empId}`, { branchId: b2 });
assert.equal(r.status, 200);
r = await employee("GET", "/api/me");
assert.equal(r.data.branch.id, b2);

step("Сброс пароля по одноразовой ссылке от директора");
r = await director("POST", `/api/members/${empId}/reset-link`, {});
assert.equal(r.status, 200, JSON.stringify(r.data));
const resetToken = r.data.resetUrl.split("/reset/")[1];
r = await anon("GET", `/api/auth/reset?token=${resetToken}`);
assert.equal(r.data.valid, true);
r = await anon("POST", "/api/auth/reset", { token: resetToken, password: "short" });
assert.equal(r.status, 400, "короткий пароль не гасит ссылку");
r = await anon("POST", "/api/auth/reset", { token: resetToken, password: "new-employee-pass" });
assert.equal(r.status, 200);
r = await employee("GET", "/api/me");
assert.equal(r.status, 401, "старые сессии завершены");
r = await employee("POST", "/api/auth/login", { login: `emp-${suffix}`, password: "new-employee-pass" });
assert.equal(r.status, 200);
r = await anon("POST", "/api/auth/reset", { token: resetToken, password: "another-pass-123" });
assert.equal(r.status, 410, "ссылка одноразовая");
r = await manager("POST", `/api/members/${empId}/reset-link`, {});
assert.equal(r.status, 403, "руководитель другого филиала не сбрасывает пароль");

step("Отзыв роли действует в открытой сессии");
r = await director("PATCH", `/api/members/${empId}`, { active: false });
assert.equal(r.status, 200);
r = await employee("GET", "/api/me");
assert.ok([401, 403].includes(r.status));
r = await employee("POST", "/api/auth/login", { login: `emp-${suffix}`, password: "new-employee-pass" });
assert.equal(r.status, 403);

step("Возврат доступа и приглашение для существующего аккаунта");
r = await director("PATCH", `/api/members/${empId}`, { active: true });
assert.equal(r.status, 200);
r = await employee("POST", "/api/auth/login", { login: `emp-${suffix}`, password: "new-employee-pass" });
assert.equal(r.status, 200);
r = await director("POST", "/api/invites", { role: "employee", branchId: b1, note: "Повторный", ttlHours: 2 });
const reInv = tokenOf(r.data.inviteUrl);
r = await anon("GET", `/api/invites/lookup?token=${reInv}`);
assert.equal(r.data.nameHint, "Повторный");
r = await anon("POST", "/api/invites/accept-existing", { token: reInv, login: `emp-${suffix}`, password: "new-employee-pass" });
assert.equal(r.status, 409, "у активного участника второе членство не создаётся");
r = await director("PATCH", `/api/members/${empId}`, { active: false });

step("Отзыв приглашения");
r = await director("POST", "/api/invites", { role: "employee", branchId: b1 });
const revInvId = r.data.id;
const revInvToken = tokenOf(r.data.inviteUrl);
r = await director("DELETE", `/api/invites/${revInvId}`);
assert.equal(r.status, 200);
r = await anon("GET", `/api/invites/lookup?token=${revInvToken}`);
assert.equal(r.data.valid, false);

step("Выход завершает сессию");
r = await manager("POST", "/api/auth/logout", {});
assert.equal(r.status, 200);
r = await manager("GET", "/api/me");
assert.equal(r.status, 401);

// Данные для следующих проверок (scripts/smoke-tasks.mjs). Только тестовая БД.
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(".wrangler", { recursive: true });
writeFileSync(
  ".wrangler/smoke-state.json",
  JSON.stringify({ base: BASE, suffix, director: { login: `dir-${suffix}`, password: "director-pass-1" }, manager2: { login: `mgr2-${suffix}`, password: "manager-pass-2" }, b1, b2 }),
);

console.log("\n✓ Этап 1: все сценарии пройдены");
