import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate, parseRelative } from "../server/assistant/dates.ts";

const today = "2026-11-26"; // четверг

test("Даты помощника", () => {
  assert.deepEqual(parseDate("сдать отчёт завтра", today)?.date, "2026-11-27");
  assert.deepEqual(parseDate("Послезавтра в 18:30", today), { date: "2026-11-28", time: "18:30", match: "послезавтра" });
  assert.equal(parseDate("до пятницы", today)?.date, "2026-11-27");
  assert.equal(parseDate("в понедельник", today)?.date, "2026-11-30");
  assert.equal(parseDate("в четверг", today)?.date, "2026-12-03", "сегодняшний день недели — следующая неделя");
  assert.equal(parseDate("к 05.12", today)?.date, "2026-12-05");
  assert.equal(parseDate("к 05.01", today)?.date, "2027-01-05", "прошедшая дата без года — следующий год");
  assert.equal(parseDate("срок 2026-12-31 в 9:15", today)?.time, "09:15");
  assert.equal(parseDate("через 3 дня", today)?.date, "2026-11-29");
  assert.equal(parseDate("купить муку", today), null);
});

test("Относительное время", () => {
  assert.deepEqual(parseRelative("напомни через 2 часа"), { inMinutes: 120 });
  assert.deepEqual(parseRelative("через 30 минут"), { inMinutes: 30 });
  assert.deepEqual(parseRelative("за 1 час до срока"), { beforeMinutes: 60 });
  assert.deepEqual(parseRelative("за день"), { beforeMinutes: 1440 });
});
