// Сквозная проверка WhatsApp на заглушке Whapi (без реального номера).
// Запускается из scripts/smoke-all.sh: dev-сервер получает WHAPI_TOKEN=test и WHAPI_API_URL заглушки.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";

const state = JSON.parse(readFileSync(".wrangler/smoke-state.json", "utf8"));
const BASE = process.env.BASE_URL ?? state.base;
const MOCK_PORT = Number(process.env.WHAPI_MOCK_PORT ?? 5199);
const origin = new URL(BASE).origin;

// Заглушка Whapi: принимает отправленные сообщения и отвечает на /health.
const sent = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: { text: "AUTH" }, user: { id: "77010000000" } }));
      return;
    }
    if (req.url === "/messages/text") sent.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ sent: true }));
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { origin } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const m = /am_sid=([^;]*)/.exec(res.headers.get("set-cookie") ?? "");
    if (m) cookie = m[1] ? `am_sid=${m[1]}` : "";
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const step = (n) => console.log(`• ${n}`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const e1 = client();
const m1 = client();
const director = client();
const PHONE = "77011112233";

try {
  await e1("POST", "/api/auth/login", { login: `e1-${state.suffix}t`, password: "password-123" });
  await m1("POST", "/api/auth/login", { login: `m1-${state.suffix}t`, password: "password-123" });
  await director("POST", "/api/auth/login", state.director);

  step("Подключения: реальное состояние канала и адрес вебхука");
  let r = await director("GET", "/api/settings/connections");
  assert.equal(r.data.whapi.ok, true, JSON.stringify(r.data.whapi));
  const webhook = new URL(r.data.whapi.webhookUrl).pathname;
  const hook = (messages) => fetch(BASE + webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }) });
  assert.equal((await fetch(`${BASE}/api/whapi/webhook/wrong-key`, { method: "POST", body: "{}" })).status, 404, "чужой ключ вебхука отклоняется");

  step("Привязка номера одноразовым кодом из профиля");
  r = await e1("POST", "/api/me/phone/code", {});
  assert.match(r.data.code, /^\d{6}$/);
  await hook([{ id: "wa-1", from: PHONE, type: "text", text: { body: `Код ${r.data.code}` } }]);
  assert.ok(sent.some((s) => s.to === PHONE && /Номер привязан/.test(s.body)));
  r = await e1("GET", "/api/me");
  assert.equal(r.data.user.phoneLinked, true);

  step("Непривязанный номер ничего не получает");
  const before = sent.length;
  await hook([{ id: "wa-2", from: "77019999999", type: "text", text: { body: "мои задачи" } }]);
  assert.equal(sent.length, before);

  step("Сообщение с привязанного номера — ответ в WhatsApp, повтор доставки не дублирует");
  await hook([{ id: "wa-3", from: `${PHONE}@s.whatsapp.net`, type: "text", text: { body: "создай Заказать упаковку завтра" } }]);
  await hook([{ id: "wa-3", from: `${PHONE}@s.whatsapp.net`, type: "text", text: { body: "создай Заказать упаковку завтра" } }]);
  const replies = sent.filter((s) => s.to === PHONE && /Создал личную задачу/.test(s.body));
  assert.equal(replies.length, 1, "одна задача — один ответ");
  assert.match(replies[0].body, /\/tasks\//, "в ответе ссылка на карточку");
  r = await e1("GET", `/api/tasks?q=${encodeURIComponent("Заказать упаковку")}`);
  assert.equal(r.data.items.length, 1, "изменение появилось в кабинете один раз");
  r = await e1("GET", "/api/assistant");
  assert.ok(!r.data.messages.some((m) => m.text.includes("Заказать упаковку")), "истории веба и WhatsApp раздельные");

  step("Восстановление пароля кодом в WhatsApp");
  await fetch(`${BASE}/api/auth/recover/request`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ login: `e1-${state.suffix}t` }) });
  const codeMsg = sent.findLast((s) => s.to === PHONE && /Код для восстановления/.test(s.body));
  assert.ok(codeMsg);
  const code = /(\d{6})/.exec(codeMsg.body)[1];
  const rec = await fetch(`${BASE}/api/auth/recover`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ login: `e1-${state.suffix}t`, code, password: "password-123" }),
  });
  assert.equal(rec.status, 200);
  await e1("POST", "/api/auth/login", { login: `e1-${state.suffix}t`, password: "password-123" });

  step("Уведомление о назначении приходит в WhatsApp");
  r = await e1("GET", "/api/notifications");
  await e1("PATCH", "/api/notifications/prefs", { ...r.data.prefs, channels: { whatsapp: true, push: false }, quiet: { ...r.data.prefs.quiet, enabled: false }, pausedUntil: null });
  const me1 = (await e1("GET", "/api/me")).data.user.id;
  await m1("POST", "/api/tasks", { opId: crypto.randomUUID(), title: "Проверить витрину", assigneeId: me1 });
  for (let i = 0; i < 10 && !sent.some((s) => s.to === PHONE && /Проверить витрину/.test(s.body)); i++) {
    await e1("GET", "/api/notifications"); // открытие «Уведомлений» обрабатывает очередь участника
    await wait(300);
  }
  assert.ok(sent.some((s) => s.to === PHONE && /Вам назначена задача: «Проверить витрину»/.test(s.body)));

  step("Отвязка номера: дальше ничего не отправляется");
  await e1("DELETE", "/api/me/phone");
  const count = sent.length;
  await hook([{ id: "wa-9", from: PHONE, type: "text", text: { body: "мои задачи" } }]);
  assert.equal(sent.length, count);

  console.log("\n✓ WhatsApp: все сценарии пройдены (на заглушке Whapi)");
} finally {
  mock.close();
}
