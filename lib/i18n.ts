import { companyConfig } from "@/config/company";
import { messages, type Locale } from "@/i18n/messages";
import { formatShortDateTime } from "./format";

const locale: Locale = companyConfig.locale;

function lookup(tree: unknown, path: string[]): unknown {
  let node = tree;
  for (const part of path) {
    if (node && typeof node === "object" && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return node;
}

/** t("login.title"), t("branch.members", { n: 3 }). Нет перевода — берётся ru, затем сам ключ. */
export function t(key: string, params?: Record<string, string | number>): string {
  const path = key.split(".");
  let value = lookup(messages[locale], path);
  if (typeof value !== "string") value = lookup(messages.ru, path);
  if (typeof value !== "string") return key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export function errorText(code: string | undefined | null): string {
  if (!code) return t("errors.internal");
  const text = t(`errors.${code}`);
  return text === `errors.${code}` ? t("errors.internal") : text;
}

export function fieldText(code: string | undefined | null): string | undefined {
  if (!code) return undefined;
  const text = t(`fields.${code}`);
  if (text !== `fields.${code}`) return text;
  const err = t(`errors.${code}`);
  return err !== `errors.${code}` ? err : code;
}

/** Дата и время в поясе браузера (страницы без входа, где пояс компании неизвестен). */
export function formatDateTime(ms: number): string {
  return formatShortDateTime(ms, Intl.DateTimeFormat().resolvedOptions().timeZone);
}
