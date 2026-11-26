// Проверка артефакта сборки для ChatGPT Sites.
import { existsSync, readFileSync, readdirSync } from "node:fs";

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const server = "dist/server/index.js";
if (!existsSync(server)) fail(`${server} не найден`);
const code = readFileSync(server, "utf8");
if (!/export\s*\{[^}]*\bdefault\b|export default/.test(code)) fail(`${server} не экспортирует default`);
if (!existsSync("dist/.openai/hosting.json")) fail("dist/.openai/hosting.json не найден");
const hosting = JSON.parse(readFileSync("dist/.openai/hosting.json", "utf8"));
if (hosting.d1 !== "DB" || hosting.r2 !== "BUCKET") fail("hosting.json: ожидаются привязки d1=DB и r2=BUCKET");
const sql = readdirSync("dist/.openai/drizzle").filter((f) => f.endsWith(".sql"));
const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
if (sql.length !== journal.entries.length) fail("число миграций в dist не совпадает с журналом");
console.log(`✓ Артефакт: ${server}, миграций: ${sql.length}, схема: ${journal.entries.at(-1)?.tag}`);
