// Применяет все миграции из /drizzle к пустой SQLite-базе в памяти (как Sites к новой D1).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys = ON;");
for (const entry of journal.entries) {
  const sql = readFileSync(`drizzle/${entry.tag}.sql`, "utf8");
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
  console.log(`✓ ${entry.tag}`);
}
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name);
const rows = tables.reduce((n, t) => n + Number(db.prepare(`SELECT count(*) AS c FROM "${t}"`).get().c), 0);
console.log(`✓ Таблиц: ${tables.length}; строк данных: ${rows} (чистый старт без примеров)`);
if (rows !== 0) process.exit(1);
