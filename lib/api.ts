"use client";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | null;
  constructor(code: string, status: number, details: Record<string, unknown> | null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
  /** Ошибки полей формы: { login: "login_taken" } */
  get fields(): Record<string, string> {
    const f = this.details?.fields;
    return f && typeof f === "object" ? (f as Record<string, string>) : {};
  }
}

type Options = { signal?: AbortSignal; redirectOn401?: boolean };

/** Запрос к серверному слою. Сессия — в HttpOnly cookie, токены в JS не попадают. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, options: Options = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("network", 0, null);
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { error?: { code: string; details: Record<string, unknown> | null } })
    | null;
  if (!response.ok) {
    const code = data?.error?.code ?? (response.status >= 500 ? "internal" : "network");
    if ((options.redirectOn401 ?? true) && (code === "unauthorized" || code === "access_revoked")) {
      const reason = code === "access_revoked" ? "revoked" : "expired";
      window.location.assign(`/login?reason=${reason}`);
    }
    throw new ApiError(code, response.status, data?.error?.details ?? null);
  }
  return data as T;
}
