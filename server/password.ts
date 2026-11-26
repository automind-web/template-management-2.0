import { fromBase64, timingSafeEqual, toBase64 } from "./crypto.ts";

const encoder = new TextEncoder();
const ALGO = "pbkdf2-sha256";
/** Cloudflare Workers ограничивает PBKDF2 значением 100 000 итераций. */
export const MAX_ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password.normalize("NFKC")), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Хеш пароля: уникальная соль 16 байт, PBKDF2-SHA256. */
export async function hashPassword(password: string, iterations = MAX_ITERATIONS): Promise<string> {
  const iter = Math.min(iterations, MAX_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iter);
  return `${ALGO}$${iter}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iterStr, saltB64, hashB64] = stored.split("$");
  if (algo !== ALGO || !iterStr || !saltB64 || !hashB64) return false;
  const iterations = Number(iterStr);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  const hash = await derive(password, fromBase64(saltB64), iterations);
  return timingSafeEqual(toBase64(hash), hashB64);
}

/** Фиктивная проверка, чтобы время ответа не выдавало существование логина. */
export async function dummyVerify(password: string): Promise<void> {
  await derive(password, new Uint8Array(16), MAX_ITERATIONS);
}
