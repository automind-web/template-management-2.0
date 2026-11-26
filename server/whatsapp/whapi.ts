/**
 * Клиент Whapi (WhatsApp). Ключ канала директор вводит на сайте; он хранится зашифрованным
 * и в браузер не передаётся. Адрес для входящих сообщений настраивается в Whapi автоматически.
 */
import { getEnv } from "../env";
import { getSecret } from "../integrations";

/** Адрес API Whapi. WHAPI_API_URL — только для тестового окружения с заглушкой. */
function api(): string {
  return (getEnv().WHAPI_API_URL || "https://gate.whapi.cloud").replace(/\/$/, "");
}

export async function whapiToken(): Promise<string | null> {
  return getSecret("whapi");
}

export async function whapiConfigured(): Promise<boolean> {
  return Boolean(await whapiToken());
}

function headers(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" };
}

/** Номер только цифрами: «+7 (999) 000-00-00» → «79990000000». */
export function normalizePhone(value: string): string {
  return value.replace(/@.*$/, "").replaceAll(/\D/g, "");
}

export async function sendWhatsAppText(to: string, body: string): Promise<{ ok: boolean; status: number }> {
  const token = await whapiToken();
  if (!token) return { ok: false, status: 0 };
  const res = await fetch(`${api()}/messages/text`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ to: normalizePhone(to), body: body.slice(0, 4000) }),
  }).catch(() => null);
  return { ok: Boolean(res?.ok), status: res?.status ?? 0 };
}

export type WhapiHealth = { ok: boolean; status: "connected" | "not_set" | "wrong_key" | "not_authorized" | "unreachable"; phone: string | null };

/** Состояние канала: ключ верный и номер авторизован в Whapi. */
export async function whapiHealth(tokenOverride?: string): Promise<WhapiHealth> {
  const token = tokenOverride ?? (await whapiToken());
  if (!token) return { ok: false, status: "not_set", phone: null };
  try {
    const res = await fetch(`${api()}/health`, { headers: headers(token) });
    if (res.status === 401 || res.status === 403) return { ok: false, status: "wrong_key", phone: null };
    if (!res.ok) return { ok: false, status: "unreachable", phone: null };
    const data = (await res.json().catch(() => null)) as { status?: { text?: string }; user?: { id?: string } } | null;
    const text = data?.status?.text ?? "";
    const authorized = /auth|connected|ready/i.test(text) && !/qr|unauth/i.test(text);
    return { ok: authorized, status: authorized ? "connected" : "not_authorized", phone: data?.user?.id ? normalizePhone(data.user.id) : null };
  } catch {
    return { ok: false, status: "unreachable", phone: null };
  }
}

/** Ключ адреса входящих сообщений: производный от ключа канала, чужие запросы отклоняются. */
export async function webhookKey(tokenOverride?: string): Promise<string | null> {
  const token = tokenOverride ?? (await whapiToken());
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`am-webhook:${token}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Прописывает в Whapi адрес сайта для входящих сообщений — директору ничего настраивать не нужно. */
export async function registerWebhook(token: string, url: string): Promise<boolean> {
  const res = await fetch(`${api()}/settings`, {
    method: "PATCH",
    headers: headers(token),
    body: JSON.stringify({ webhooks: [{ url, events: [{ type: "messages", method: "post" }], mode: "body" }] }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

export async function mediaUrl(id: string): Promise<string> {
  return `${api()}/media/${encodeURIComponent(id)}`;
}
