/**
 * Точка входа Cloudflare Worker (ChatGPT Sites). Сборка: dist/server/index.js, экспорт fetch.
 * Фоновых процессов нет: очередь уведомлений обрабатывается короткими порциями
 * в ctx.waitUntil после запросов и в scheduled(), если у Sites включён запуск по расписанию.
 */
import { DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES, handleImageOptimization } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { maybeProcessQueue, processQueue, rememberOrigin, recordScheduledRun } from "../server/notify/queue";

interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), geolocation=(), microphone=(self)",
};

function withSecurityHeaders(response: Response): Response {
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!response.headers.has(k)) response.headers.set(k, v);
    }
    return response;
  } catch {
    // Неизменяемые заголовки (например, у ответа ассетов) — копируем ответ.
    const copy = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (!copy.headers.has(k)) copy.headers.set(k, v);
    }
    return copy;
  }
}

const worker = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image" && env.IMAGES) {
      const images = env.IMAGES;
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(
        request,
        {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await images
              .input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        },
        allowedWidths,
      );
    }

    const response = await handler.fetch(request, env as never, ctx as never);
    // Очередь уведомлений — короткой порцией после ответа (не чаще раза в 15 с).
    if (url.pathname.startsWith("/api/") || request.headers.get("accept")?.includes("text/html")) {
      ctx.waitUntil(rememberOrigin(url.origin).then(() => maybeProcessQueue(request.method !== "GET" && request.method !== "HEAD")).catch(() => {}));
    }
    return withSecurityHeaders(response);
  },

  /** Запуск по расписанию, если Sites его поддерживает: доставка напоминаний без входящих запросов. */
  async scheduled(_event: unknown, _env: unknown, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processQueue({ limit: 200 }).then(recordScheduledRun));
  },
};

export default worker;
