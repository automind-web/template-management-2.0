import { env } from "cloudflare:workers";

/** Единственный секрет сайта. Ключи WhatsApp и OpenAI директор вводит в настройках, они хранятся в базе зашифрованными. */
export type SecretName = "OWNER_ACTIVATION_CODE";

/** Привязки и секреты. Секреты читаются только на сервере и не отдаются клиенту. */
export function getEnv(): AppEnv {
  return env as AppEnv;
}

export function hasSecret(name: SecretName): boolean {
  const value = getEnv()[name];
  return typeof value === "string" && value.trim().length > 0;
}
