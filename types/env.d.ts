/** Типы привязок и секретов Cloudflare Worker (ChatGPT Sites). */
interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: { changes: number; last_row_id: number; [key: string]: unknown };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(): Promise<T[]>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<unknown>;
}
interface R2ObjectBody {
  key: string;
  size: number;
  httpMetadata?: { contentType?: string };
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | Uint8Array | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<{ key: string; size: number } | null>;
  delete(key: string | string[]): Promise<void>;
}

interface AppEnv {
  DB: D1Database;
  BUCKET?: R2Bucket;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  OWNER_ACTIVATION_CODE?: string;
  WHAPI_TOKEN?: string;
  /** Не секрет: адрес API Whapi для тестового окружения (по умолчанию gate.whapi.cloud). */
  WHAPI_API_URL?: string;
  OPENAI_API_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

declare module "cloudflare:workers" {
  export const env: AppEnv;
}
