// Сквозная проверка помощника (режим команд, без ключа модели). Запускать после smoke и smoke:tasks.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync(".wrangler/smoke-state.json", "utf8"));
const BASE = process.env.BASE_URL ?? state.base;
const origin = new URL(BASE).origin;

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
const e1 = client();
const director = client();
const say = async (c, text) => {
  const r = await c("POST", "/api/assistant/message", { text, opId: crypto.randomUUID() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.messages.at(-1);
};

await e1("POST", "/api/auth/login", { login: `e1-${state.suffix}t`, password: "password-123" });
await director("POST", "/api/auth/login", state.director);

step("Без ключа модели — режим команд, памятка");
let r = await e1("GET", "/api/assistant");
assert.equal(r.data.mode, "commands");
assert.equal(r.data.voice, false);
let m = await say(e1, "помощь");
assert.match(m.text, /мои задачи/);

step("Создание личной задачи с датой и временем");
m = await say(e1, "создай Позвонить поставщику завтра в 18:00");
assert.match(m.text, /Создал личную задачу #\d+ «Позвонить поставщику», срок .*18:00/);
const created = m.links[0];
r = await e1("GET", `/api/tasks/${created.taskId}`);
assert.equal(r.data.task.isPersonal, true);
assert.equal(r.data.task.dueTime, "18:00");
assert.equal(r.data.history.filter((h) => h.type === "created").length, 1, "изменение появляется в кабинете один раз");

step("Повтор отправки с тем же opId не выполняет команду дважды");
const opId = crypto.randomUUID();
await e1("POST", "/api/assistant/message", { text: "создай Повторная проверка", opId });
await e1("POST", "/api/assistant/message", { text: "создай Повторная проверка", opId });
r = await e1("GET", `/api/tasks?q=${encodeURIComponent("Повторная проверка")}`);
assert.equal(r.data.items.length, 1);

step("Начать, сдать результат, ссылка на карточку");
m = await say(e1, `начать #${created.number}`);
assert.match(m.text, /«В работе»/);
m = await say(e1, `сдать #${created.number}: поставщик подтвердил`);
assert.match(m.text, /«На проверке»/);
assert.equal(m.links[0].taskId, created.taskId);

step("Несколько совпадений — выбор карточки");
await say(e1, "создай Отчёт по складу");
await say(e1, "создай Отчёт по кассе");
m = await say(e1, "начать отчёт");
assert.match(m.text, /несколько задач/);
m = await say(e1, "2");
assert.match(m.text, /«В работе»/);

step("Напоминание и срок");
const t2 = (await e1("GET", `/api/tasks?q=${encodeURIComponent("Повторная проверка")}`)).data.items[0];
m = await say(e1, `напомни #${t2.number} через 2 часа`);
assert.match(m.text, /Напомню о #\d+/);
r = await e1("GET", "/api/notifications");
assert.ok(r.data.scheduled >= 1);
m = await say(e1, `срок #${t2.number} в пятницу 17:30`);
assert.match(m.text, /17:30/);

step("Массовые изменения и отмена — только после подтверждения");
m = await say(e1, "перенеси все на понедельник");
assert.match(m.text, /Ответьте «да» или «нет»/);
m = await say(e1, "нет");
assert.match(m.text, /ничего не меняю/);
m = await say(e1, `отмени #${t2.number}`);
assert.match(m.text, /Ответьте «да»/);
m = await say(e1, "да");
assert.match(m.text, /отменена/);
r = await e1("GET", `/api/tasks/${t2.taskId ?? t2.id}`);
assert.ok(r.data.task.cancelledAt);

step("Помощник директора — только его личные задачи");
m = await say(director, "мои задачи");
assert.doesNotMatch(m.text, /Отчёт по складу|Позвонить поставщику/);
m = await say(director, `начать #${created.number}`);
assert.match(m.text, /не найдена/);

step("Голос: без сессии запрос отклоняется");
const form = new FormData();
form.set("audio", new Blob([new Uint8Array(100)], { type: "audio/webm" }), "voice.webm");
const res = await fetch(`${BASE}/api/assistant/voice`, { method: "POST", body: form, headers: { origin, cookie: "" } });
assert.equal(res.status, 401, "без сессии голос недоступен");

console.log("\n✓ Помощник: все сценарии пройдены");
