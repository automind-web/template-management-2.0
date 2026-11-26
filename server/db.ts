import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema";
import { getEnv } from "./env";
import { AppError } from "./errors";

export function getDb() {
  const env = getEnv();
  if (!env.DB) {
    throw new AppError("db_unavailable", 503);
  }
  return drizzle(env.DB as never, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
