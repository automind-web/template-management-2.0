import assert from "node:assert/strict";
import { test } from "node:test";
import { hashPassword, verifyPassword } from "../server/password.ts";
import { dateInZone, endOfDayInZone } from "../server/time.ts";
import { randomCode, timingSafeEqual } from "../server/crypto.ts";

test("PBKDF2: уникальная соль, проверка пароля", async () => {
  const a = await hashPassword("secret-password");
  const b = await hashPassword("secret-password");
  assert.notEqual(a, b);
  assert.match(a, /^pbkdf2-sha256\$100000\$/);
  assert.equal(await verifyPassword("secret-password", a), true);
  assert.equal(await verifyPassword("wrong", a), false);
  assert.equal(await verifyPassword("x", "garbage"), false);
});

test("Срок наступает в 23:59:59.999 по Asia/Almaty", () => {
  const due = endOfDayInZone("2026-11-24", "Asia/Almaty"); // UTC+5
  assert.equal(new Date(due).toISOString(), "2026-11-24T18:59:59.999Z");
  assert.equal(dateInZone(due, "Asia/Almaty"), "2026-11-24");
  assert.equal(dateInZone(due + 1, "Asia/Almaty"), "2026-11-25");
});

test("Конец дня учитывает переход на летнее время", () => {
  const due = endOfDayInZone("2026-03-29", "Europe/Berlin"); // в этот день UTC+2
  assert.equal(new Date(due).toISOString(), "2026-03-29T21:59:59.999Z");
});

test("Коды и сравнение", () => {
  assert.match(randomCode(10), /^[A-HJ-NP-Z2-9]{10}$/);
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
});
