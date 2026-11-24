import { env } from "cloudflare:workers";

export type SecretName =
  | "OWNER_ACTIVATION_CODE"
  | "WHAPI_TOKEN"
  | "OPENAI_API_KEY"
  | "VAPID_PUBLIC_KEY"
  | "VAPID_PRIVATE_KEY";

/** Привязки и секреты. Секреты читаются только на сервере и не отдаются клиенту. */
export function getEnv(): AppEnv {
  return env as AppEnv;
}

export function hasSecret(name: SecretName): boolean {
  const value = getEnv()[name];
  return typeof value === "string" && value.trim().length > 0;
}
