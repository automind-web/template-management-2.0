/**
 * Ошибка операции. `code` — ключ текста в i18n/messages.ts (errors.<code>),
 * клиент показывает перевод. Внутренние детали наружу не уходят.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: string, status = 400, details?: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const unauthorized = () => new AppError("unauthorized", 401);
export const forbidden = (code = "forbidden") => new AppError(code, 403);
export const notFound = (code = "not_found") => new AppError(code, 404);
