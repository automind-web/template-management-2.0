/** Даты в часовом поясе компании: «25 нояб., 23:59» (год — только если не текущий). */
export function formatShortDateTime(ms: number, timeZone: string): string {
  const d = new Date(ms);
  const sameYear =
    new Intl.DateTimeFormat("ru-RU", { timeZone, year: "numeric" }).format(d) ===
    new Intl.DateTimeFormat("ru-RU", { timeZone, year: "numeric" }).format(new Date());
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return `${date.replace(/\s?г\.$/, "")}, ${time}`;
}


/** Длительность: «0 мин», «3 ч 20 мин», «2 д 4 ч». */
export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} ч ${min % 60} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} д ${h % 24} ч` : `${d} д`;
}

/** Дата YYYY-MM-DD в поясе компании. */
export function dateInTz(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** «1 нояб.» из YYYY-MM-DD. */
export function formatDayMonth(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}
