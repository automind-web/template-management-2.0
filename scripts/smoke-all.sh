#!/usr/bin/env bash
# Все сквозные проверки на чистой локальной БД: пересоздаёт .wrangler/state/v3/d1, запускает dev-сервер.
set -euo pipefail
PORT="${PORT:-5173}"
pkill -f "vite --port ${PORT}" 2>/dev/null || true
sleep 1
npm run db:reset:local >/dev/null
npx vite --port "${PORT}" > .wrangler/smoke-dev.log 2>&1 &
SERVER=$!
trap 'kill ${SERVER} 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do curl -sf -o /dev/null "http://localhost:${PORT}/api/health" && break; sleep 1; done
export BASE_URL="http://localhost:${PORT}"
node scripts/smoke.mjs
node scripts/smoke-tasks.mjs
node scripts/smoke-assistant.mjs
