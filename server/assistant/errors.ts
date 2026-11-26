import { messages } from "../../i18n/messages";

/** Текст ошибки операции для ответа помощника (тот же словарь, что у сайта). */
export function errorMessage(code: string): string {
  const errors = messages.ru.errors as Record<string, string>;
  return errors[code] ?? errors.internal!;
}
