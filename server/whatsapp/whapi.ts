/**
 * Клиент Whapi (WhatsApp). Токен — только из секрета сайта WHAPI_TOKEN, в браузер не передаётся.
 * Документация: https://whapi.readme.io
 */
import { getEnv } from "../env";

const API = "https://gate.whapi.cloud";

export function whapiConfigured(): boolean {
  return Boolean(getEnv().WHAPI_TOKEN?.trim());
}

function headers() {
  return { authorization: `Bearer ${getEnv().WHAPI_TOKEN!.trim()}`, "content-type": "application/json", accept: "application/json" };
}

/** Номер только цифрами: «+7 (999) 000-00-00» → «79990000000». */
export function normalizePhone(value: string): string {
  return value.replace(/@.*$/, "").replaceAll(/\D/g, "");
}

export async function sendWhatsAppText(to: string, body: string): Promise<{ ok: boolean; status: number }> {
  if (!whapiConfigured()) return { ok: false, status: 0 };
  const res = await fetch(`${API}/messages/text`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ to: normalizePhone(to), body: body.slice(0, 4000) }),
  });
  return { ok: res.ok, status: res.status };
}

/** Реальное состояние канала для «Подключений». */
export async function whapiHealth(): Promise<{ ok: boolean; status: string; phone: string | null }> {
  if (!whapiConfigured()) return { ok: false, status: "missing_secret", phone: null };
  try {
    const res = await fetch(`${API}/health`, { headers: headers() });
    if (res.status === 401 || res.status === 403) return { ok: false, status: "unauthorized", phone: null };
    if (!res.ok) return { ok: false, status: `http_${res.status}`, phone: null };
    const data = (await res.json().catch(() => null)) as { status?: { text?: string }; user?: { id?: string } } | null;
    const text = data?.status?.text ?? "unknown";
    return { ok: /auth|connected|ready/i.test(text) && !/qr|unauthorized/i.test(text), status: text, phone: data?.user?.id ? normalizePhone(data.user.id) : null };
  } catch {
    return { ok: false, status: "unreachable", phone: null };
  }
}

/** Ключ вебхука: производный от токена, чтобы чужие запросы на адрес вебхука отклонялись. */
export async function webhookKey(): Promise<string | null> {
  const token = getEnv().WHAPI_TOKEN?.trim();
  if (!token) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`am-webhook:${token}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}
