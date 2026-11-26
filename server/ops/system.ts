import journal from "../../drizzle/meta/_journal.json" with { type: "json" };
import pkg from "../../package.json" with { type: "json" };
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { getEnv } from "../env";

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
