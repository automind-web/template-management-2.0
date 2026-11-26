/**
 * Подключения компании, которые директор задаёт на сайте: ключ WhatsApp (Whapi), ключ OpenAI,
 * модель и инструкции помощника. Ключи хранятся в D1 зашифрованными (AES-GCM); ключ шифрования
 * выводится из секрета сайта OWNER_ACTIVATION_CODE. В браузер ключи не передаются никогда —
 * наружу уходит только «задан / не задан» и последние 4 символа.
 *
 * Ключи push-уведомлений создаются автоматически при первом обращении.
 * Установка рассчитана на одну компанию: подключения берутся у неё.
 */
import { and, eq } from "drizzle-orm";
import { fromBase64, toBase64 } from "./crypto";
import { getDb, schema } from "./db";
import { getEnv } from "./env";
import { AppError } from "./errors";
import { b64urlEncode } from "./notify/webpush";

type Kind = "whapi" | "openai" | "push";
type Stored = { secret?: string; last4?: string; publicKey?: string; status?: string; checkedAt?: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

async function cryptoKey(): Promise<CryptoKey> {
  const base = getEnv().OWNER_ACTIVATION_CODE?.trim();
  if (!base) throw new AppError("activation_code_missing", 503);
  const material = await crypto.subtle.importKey("raw", enc.encode(base), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("ai-management/integrations"), info: enc.encode("aes-gcm-256") },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encrypt(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(), enc.encode(value)));
  return `${toBase64(iv)}.${toBase64(data)}`;
}

async function decrypt(value: string): Promise<string | null> {
  try {
    const [iv, data] = value.split(".");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv!) as BufferSource }, await cryptoKey(), fromBase64(data!) as BufferSource);
    return dec.decode(plain);
  } catch {
    return null; // код активации сменили — ключ нужно ввести заново
  }
}

async function companyId(): Promise<string | null> {
  const company = await getDb().query.companies.findFirst();
  return company?.id ?? null;
}

async function read(kind: Kind): Promise<Stored | null> {
  const id = await companyId();
  if (!id) return null;
  const row = await getDb().query.integrations.findFirst({ where: and(eq(schema.integrations.companyId, id), eq(schema.integrations.kind, kind)) });
  return row ? (JSON.parse(row.configJson) as Stored) : null;
}

async function write(kind: Kind, value: Stored, userId: string | null): Promise<void> {
  const id = await companyId();
  if (!id) throw new AppError("no_company", 409);
  const now = Date.now();
  const configJson = JSON.stringify(value);
  await getDb()
    .insert(schema.integrations)
    .values({ companyId: id, kind, enabled: Boolean(value.secret), configJson, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.integrations.companyId, schema.integrations.kind],
      set: { enabled: Boolean(value.secret), configJson, updatedBy: userId, updatedAt: now },
    });
}

/** Сохранить ключ (пустая строка — удалить). */
export async function saveSecret(kind: "whapi" | "openai", value: string, userId: string, extra: Partial<Stored> = {}): Promise<void> {
  const clean = value.trim();
  if (!clean) return write(kind, {}, userId);
  await write(kind, { secret: await encrypt(clean), last4: clean.slice(-4), ...extra }, userId);
}

export async function setStatus(kind: "whapi" | "openai", status: string): Promise<void> {
  const current = await read(kind);
  if (!current?.secret) return;
  await write(kind, { ...current, status, checkedAt: Date.now() }, null);
}

export async function getSecret(kind: "whapi" | "openai"): Promise<string | null> {
  const stored = await read(kind);
  return stored?.secret ? decrypt(stored.secret) : null;
}

export async function secretInfo(kind: "whapi" | "openai"): Promise<{ set: boolean; last4: string | null; status: string | null; checkedAt: number | null }> {
  const stored = await read(kind);
  return { set: Boolean(stored?.secret), last4: stored?.last4 ?? null, status: stored?.status ?? null, checkedAt: stored?.checkedAt ?? null };
}

/** Ключи push-уведомлений: создаются один раз автоматически (ECDSA P-256). */
export async function pushKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (!getEnv().OWNER_ACTIVATION_CODE?.trim() || !(await companyId())) return null;
  const stored = await read("push");
  if (stored?.secret && stored.publicKey) {
    const privateKey = await decrypt(stored.secret);
    if (privateKey) return { publicKey: stored.publicKey, privateKey };
  }
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = b64urlEncode(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer));
  await write("push", { secret: await encrypt(jwk.d!), publicKey }, null);
  // Старые подписки устройств подписаны прежним ключом — они больше не действуют.
  await getDb().update(schema.pushSubscriptions).set({ revokedAt: Date.now() });
  return { publicKey, privateKey: jwk.d! };
}
