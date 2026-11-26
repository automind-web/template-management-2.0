// Сквозная проверка этапа 2 (задачи). Запускать ПОСЛЕ scripts/smoke.mjs на той же тестовой БД.
// Запуск: npm run smoke && npm run smoke:tasks
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const state = JSON.parse(readFileSync(".wrangler/smoke-state.json", "utf8"));
const BASE = process.env.BASE_URL ?? state.base;
const origin = new URL(BASE).origin;
const sfx = `${state.suffix}t`;

function client() {
  let cookie = "";
  return async function call(method, path, body, { raw = false } = {}) {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      redirect: "manual",
    });
    const m = /am_sid=([^;]*)/.exec(res.headers.get("set-cookie") ?? "");
    if (m) cookie = m[1] ? `am_sid=${m[1]}` : "";
    if (raw) return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

const step = (name) => console.log(`• ${name}`);
const op = () => crypto.randomUUID();
const tokenOf = (url) => url.split("/invite/")[1];
const { b1, b2 } = state;

const director = client();
const m1 = client();
const m2 = client();
const e1 = client();
const e2 = client();

step("Подготовка: вход директора, приглашения в филиал 1");
let r = await director("POST", "/api/auth/login", state.director);
assert.equal(r.status, 200);
r = await m2("POST", "/api/auth/login", state.manager2);
assert.equal(r.status, 200);
for (const [c, role, login, name] of [
  [m1, "manager", `m1-${sfx}`, "Руководитель Первый"],
  [e1, "employee", `e1-${sfx}`, "Айгерим Сотрудница-Очень-Длинная-Фамилия"],
  [e2, "employee", `e2-${sfx}`, "Сотрудник Второй"],
]) {
  r = await director("POST", "/api/invites", { role, branchId: b1 });
  r = await c("POST", "/api/invites/accept", { token: tokenOf(r.data.inviteUrl), login, displayName: name, password: "password-123" });
  assert.equal(r.status, 200);
}
const e1Id = (await e1("GET", "/api/me")).data.user.id;
const e2Id = (await e2("GET", "/api/me")).data.user.id;

step("Сотрудник создаёт личную задачу без срока");
r = await e1("POST", "/api/tasks", { opId: op(), title: "Личный отчёт по складу" });
assert.equal(r.status, 201, JSON.stringify(r.data));
const personal = r.data.task;
assert.equal(personal.isPersonal, true);
assert.equal(personal.dueDate, null);
assert.equal(personal.status.name, "Новая");
r = await e1("POST", "/api/tasks", { opId: op(), title: "Чужая", assigneeId: e2Id });
assert.equal(r.status, 403, "сотрудник ставит задачи только себе");

step("Руководитель назначает задачу со сроком вчера; повтор opId не создаёт дубль");
const yesterday = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
const createOp = op();
const payload = {
  opId: createOp,
  title: "Подготовить ОТЧЁТ для директора",
  assigneeId: e1Id,
  dueDate: yesterday,
  description: "Сводка продаж",
  resultCriteria: "Файл с таблицей",
  checklist: [{ id: "a", text: "Собрать данные", done: false }, { id: "b", text: "Проверить", done: false }],
  requiresResult: true,
  requiresAttachment: true,
};
r = await m1("POST", "/api/tasks", payload);
assert.equal(r.status, 201);
const task = r.data.task;
assert.equal(task.overdue, true);
r = await m1("POST", "/api/tasks", payload);
assert.equal(r.status, 200);
assert.equal(r.data.task.id, task.id, "повтор вернул ту же задачу");
assert.equal(r.data.replayed, true);
assert.equal(r.data.history.filter((h) => h.type === "created").length, 1, "одна запись создания");

step("Изоляция: другой филиал и коллега не видят задачу (в т. ч. по прямой ссылке)");
r = await m2("GET", `/api/tasks/${task.id}`);
assert.equal(r.status, 404);
r = await m2("GET", `/api/tasks?branch=${b1}`);
assert.equal(r.status, 403);
r = await e2("GET", `/api/tasks/${task.id}`);
assert.equal(r.status, 404);
r = await e2("GET", `/api/tasks?branch=${b1}&view=all`);
assert.ok(r.data.items.every((i) => i.assignee.id === e2Id));

step("Список: поиск по кириллице без учёта регистра, счётчики, фильтры");
r = await e1("GET", `/api/tasks?branch=${b1}`);
assert.equal(r.data.viewsDiffer, false, "у сотрудника виды совпадают");
assert.equal(r.data.items.length, 2);
const sum = Object.values(r.data.counts.byStatus).reduce((a, b) => a + b, 0);
assert.equal(sum, r.data.counts.total);
assert.equal(r.data.counts.overdue, 1);
r = await e1("GET", `/api/tasks?branch=${b1}&q=${encodeURIComponent("отчёт")}`);
assert.equal(r.data.items.length, 2);
r = await e1("GET", `/api/tasks?branch=${b1}&q=${encodeURIComponent("ДИРЕКТОРА")}`);
assert.equal(r.data.items.length, 1);
r = await e1("GET", `/api/tasks?branch=${b1}&due=overdue`);
assert.deepEqual(r.data.items.map((i) => i.id), [task.id]);
r = await e1("GET", `/api/tasks?branch=${b1}&due=none`);
assert.deepEqual(r.data.items.map((i) => i.id), [personal.id]);
r = await m1("GET", `/api/tasks?branch=${b1}&assignee=${e1Id}`);
assert.equal(r.data.items.length, 2);
assert.equal(r.data.viewsDiffer, true);
r = await m1("GET", `/api/tasks?branch=${b1}&view=mine`);
assert.equal(r.data.items.length, 0);
r = await director("GET", "/api/tasks");
assert.equal(r.data.allBranches, true, "директор по умолчанию видит все филиалы");
r = await director("POST", "/api/tasks", { opId: op(), title: "Без филиала" });
assert.equal(r.status, 400, "для создания задачи нужен конкретный филиал");
r = await director("GET", `/api/tasks?branch=${b1}`);
assert.equal(r.data.items.length, 2);

step("Начало работы; устаревшая версия → конфликт с актуальным состоянием");
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version: task.version, to: "in_progress" });
assert.equal(r.status, 200);
assert.equal(r.data.task.status.key, "in_progress");
assert.equal(r.data.primary, "review", "следующее действие — сдать");
let version = r.data.task.version;
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version: task.version, to: "review", result: "x" });
assert.equal(r.status, 409);
assert.equal(r.data.error.code, "version_conflict");
assert.equal(r.data.error.details.current.task.version, version);

step("Чек-лист: исполнитель отмечает пункт, но не меняет название задачи");
r = await e1("PATCH", `/api/tasks/${task.id}`, {
  opId: op(),
  version,
  checklist: [{ id: "a", text: "Собрать данные", done: true }, { id: "b", text: "Проверить", done: false }],
});
assert.equal(r.status, 200);
version = r.data.task.version;
r = await e1("PATCH", `/api/tasks/${task.id}`, { opId: op(), version, title: "Взлом" });
assert.equal(r.status, 403);

step("Сдача: нужен результат и вложение");
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version, to: "review" });
assert.equal(r.status, 400);
assert.equal(r.data.error.code, "result_required");
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version, to: "review", result: "Готово" });
assert.equal(r.data.error.code, "attachment_required");
const form = new FormData();
form.set("file", new Blob([Buffer.from("col1,col2\n1,2\n")], { type: "text/csv" }), "отчёт.csv");
r = await e1("POST", `/api/tasks/${task.id}/attachments`, form);
assert.equal(r.status, 200, JSON.stringify(r.data));
const attId = r.data.attachments[0].id;
version = r.data.task.version;
r = await e1("GET", `/api/attachments/${attId}`, undefined, { raw: true });
assert.equal(r.status, 200);
assert.equal(r.body.toString(), "col1,col2\n1,2\n");
assert.match(r.headers.get("content-disposition"), /attachment/);
r = await m2("GET", `/api/attachments/${attId}`, undefined, { raw: true });
assert.equal(r.status, 404, "файл чужого филиала недоступен по прямой ссылке");
r = await e2("GET", `/api/attachments/${attId}`, undefined, { raw: true });
assert.equal(r.status, 404);
const submitOp = op();
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: submitOp, version, to: "review", result: "Отчёт приложен" });
assert.equal(r.status, 200);
assert.equal(r.data.task.status.name, "На проверке");
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: submitOp, version, to: "review", result: "Отчёт приложен" });
assert.equal(r.data.replayed, true, "повтор доставки сдачи");
assert.equal(r.data.history.filter((h) => h.type === "submitted").length, 1);
assert.equal(r.data.comments.filter((c) => c.kind === "result").length, 1);
version = r.data.task.version;

step("Приёмка: сотрудник не принимает сам; возврат требует комментарий");
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version, to: "done" });
assert.equal(r.status, 403);
r = await m1("GET", `/api/tasks/${task.id}`);
assert.equal(r.data.primary, "done", "у руководителя основное действие — принять");
r = await m1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version, to: "in_progress" });
assert.equal(r.data.error.code, "comment_required");
r = await m1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version, to: "in_progress", comment: "Добавьте итоги" });
assert.equal(r.status, 200);
assert.equal(r.data.history[0].type, "returned");
assert.equal(r.data.history[0].oldValue, "На проверке");
version = r.data.task.version;
r = await e1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version, to: "review", result: "Итоги добавлены" });
version = r.data.task.version;
r = await m1("POST", `/api/tasks/${task.id}/status`, { opId: op(), version, to: "done" });
assert.equal(r.status, 200);
assert.equal(r.data.task.status.name, "Завершена");
assert.equal(r.data.task.overdue, false);
assert.equal(r.data.history[0].type, "accepted");

step("Срок с временем и время по умолчанию из настроек компании");
r = await m1("POST", "/api/tasks", { opId: op(), title: "Срок с временем", dueDate: "2026-12-10", dueTime: "18:30" });
assert.equal(r.data.task.dueTime, "18:30");
const at = new Date(r.data.task.dueAt);
assert.equal(at.toISOString().slice(11, 16), "13:30", "18:30 по Алматы = 13:30 UTC");
r = await m1("GET", `/api/tasks?branch=${b1}&q=${encodeURIComponent("айгерим")}`);
assert.ok(r.data.items.length >= 1, "поиск по имени исполнителя");

step("История: переназначение и перенос срока с прежними значениями");
r = await m1("POST", "/api/tasks", { opId: op(), title: "Инвентаризация", assigneeId: e1Id, dueDate: "2026-12-01" });
const t2 = r.data.task;
r = await m1("PATCH", `/api/tasks/${t2.id}`, { opId: op(), version: t2.version, assigneeId: e2Id, dueDate: "2026-12-05" });
assert.equal(r.status, 200);
const assigned = r.data.history.find((h) => h.type === "assigned" && h.oldValue);
assert.equal(assigned.oldValue, "Айгерим Сотрудница-Очень-Длинная-Фамилия");
assert.equal(assigned.newValue, "Сотрудник Второй");
const due = r.data.history.find((h) => h.type === "due_changed");
assert.equal(due.oldValue, "2026-12-01 23:59");
assert.equal(due.newValue, "2026-12-05 23:59");
r = await e1("GET", `/api/tasks/${t2.id}`);
assert.equal(r.status, 404, "после передачи прежний исполнитель задачу не видит");
r = await e2("GET", `/api/tasks/${t2.id}`);
assert.equal(r.status, 200);

step("Отмена и восстановление");
r = await m1("GET", `/api/tasks/${t2.id}`);
r = await m1("POST", `/api/tasks/${t2.id}/cancel`, { opId: op(), version: r.data.task.version });
assert.equal(r.status, 200);
r = await m1("GET", `/api/tasks?branch=${b1}`);
assert.ok(!r.data.items.some((i) => i.id === t2.id));
assert.equal(r.data.counts.cancelled, 1);
r = await m1("GET", `/api/tasks?branch=${b1}&status=_cancelled`);
assert.deepEqual(r.data.items.map((i) => i.id), [t2.id]);
r = await m1("POST", `/api/tasks/${t2.id}/restore`, { opId: op(), version: r.data.items[0].version });
assert.equal(r.status, 200);

step("Отзыв роли: открытая сессия сразу теряет доступ к задачам");
r = await director("PATCH", `/api/members/${e2Id}`, { active: false });
r = await e2("GET", `/api/tasks/${t2.id}`);
assert.ok([401, 403].includes(r.status));

console.log("\n✓ Этап 2: все сценарии пройдены");
