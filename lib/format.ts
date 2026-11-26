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

