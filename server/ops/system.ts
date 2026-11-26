import journal from "../../drizzle/meta/_journal.json" with { type: "json" };
import pkg from "../../package.json" with { type: "json" };
import { sql } from "drizzle-orm";
import type { Actor } from "../context";
import { getDb } from "../db";
import { getEnv, hasSecret } from "../env";
import { assertManagerOrDirector, isDirector } from "../permissions";

export const BUILD_VERSION = pkg.version;
export const SCHEMA_VERSION = journal.entries.at(-1)?.tag ?? "none";

export async function health() {
  let db = false;
  try {
    await getDb().run(sql`select 1`);
    db = true;
  } catch {
    db = false;
  }
  return {
    ok: db,
    build: BUILD_VERSION,
    schema: SCHEMA_VERSION,
    bindings: { db, bucket: Boolean(getEnv().BUCKET) },
  };
}

/**
 * Реальное состояние подключений для «Настроек системы».
 * Возвращает только факт наличия секретов, не значения.
 */
export async function systemStatus(actor: Actor) {
  assertManagerOrDirector(actor);
  const env = getEnv();
  const base = {
    build: BUILD_VERSION,
    schema: SCHEMA_VERSION,
    bindings: { db: Boolean(env.DB), bucket: Boolean(env.BUCKET) },
  };
  if (!isDirector(actor)) return base;
  return {
    ...base,
    connections: {
      whapi: {
        configured: hasSecret("WHAPI_TOKEN"),
        state: hasSecret("WHAPI_TOKEN") ? "not_checked" : "missing_secret",
        recovery: "whapi_recovery",
      },
      openai: {
        configured: hasSecret("OPENAI_API_KEY"),
        state: hasSecret("OPENAI_API_KEY") ? "not_checked" : "missing_secret",
        recovery: "openai_recovery",
      },
      push: {
        configured: hasSecret("VAPID_PUBLIC_KEY") && hasSecret("VAPID_PRIVATE_KEY"),
        state: hasSecret("VAPID_PUBLIC_KEY") && hasSecret("VAPID_PRIVATE_KEY") ? "ready" : "missing_secret",
        recovery: "push_recovery",
      },
      files: {
        configured: Boolean(env.BUCKET),
        state: env.BUCKET ? "ready" : "missing_binding",
        recovery: "files_recovery",
      },
    },
  };
}
