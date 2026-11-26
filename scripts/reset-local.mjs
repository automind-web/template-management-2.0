// Удаляет ТОЛЬКО локальную D1 разработки (.wrangler/state/v3/d1) и применяет миграции заново.
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

rmSync(".wrangler/state/v3/d1", { recursive: true, force: true });
const r = spawnSync("node", ["scripts/migrate-local.mjs"], { stdio: "inherit" });
process.exit(r.status ?? 1);
