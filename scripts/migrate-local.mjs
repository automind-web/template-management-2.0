// Применяет миграции к локальной D1 (Miniflare), которую использует `npm run dev`.
// В облаке это делает ChatGPT Sites сам по пакету dist/.openai/drizzle.
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

mkdirSync(".wrangler", { recursive: true });
const config = {
  name: "ai-management-local",
  main: "../worker/index.ts",
  compatibility_date: "2026-11-01",
  d1_databases: [
    {
      binding: "DB",
      database_name: "ai-management-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
      migrations_dir: "../drizzle",
    },
  ],
};
writeFileSync(".wrangler/migrate.local.json", JSON.stringify(config, null, 2));
const result = spawnSync(
  "npx",
  ["wrangler", "d1", "migrations", "apply", "DB", "--local", "--config", ".wrangler/migrate.local.json", "--persist-to", ".wrangler/state"],
  { stdio: "inherit", env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" } },
);
process.exit(result.status ?? 1);
