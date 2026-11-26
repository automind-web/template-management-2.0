#!/usr/bin/env bash
# Все сквозные проверки на чистой локальной БД (только для разработки):
# пересоздаёт .wrangler/state/v3/d1, временно подставляет тестовые .dev.vars, запускает dev-сервер.
set -euo pipefail
PORT="${PORT:-5173}"
MOCK_PORT="${WHAPI_MOCK_PORT:-5199}"
pkill -f "vite --port ${PORT}" 2>/dev/null || true
sleep 1

# Тестовые значения: код активации и адрес заглушки Whapi (ключ вводится через настройки в smoke-whatsapp). Свой .dev.vars сохраняется и возвращается.
[ -f .dev.vars ] && cp .dev.vars .wrangler/dev.vars.backup
mkdir -p .wrangler
printf 'OWNER_ACTIVATION_CODE=local-dev-code-123\nWHAPI_API_URL=http://127.0.0.1:%s\n' "${MOCK_PORT}" > .dev.vars

npm run db:reset:local >/dev/null
npx vite --port "${PORT}" > .wrangler/smoke-dev.log 2>&1 &
SERVER=$!
cleanup() {
  kill "${SERVER}" 2>/dev/null || true
  if [ -f .wrangler/dev.vars.backup ]; then mv .wrangler/dev.vars.backup .dev.vars; else rm -f .dev.vars; fi
}
trap cleanup EXIT
for _ in $(seq 1 90); do curl -sf -o /dev/null "http://localhost:${PORT}/api/health" && break; sleep 1; done

export BASE_URL="http://localhost:${PORT}" WHAPI_MOCK_PORT="${MOCK_PORT}"
node scripts/smoke.mjs
node scripts/smoke-tasks.mjs
node scripts/smoke-assistant.mjs
node scripts/smoke-whatsapp.mjs
