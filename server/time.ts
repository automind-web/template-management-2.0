/** Работа со временем в часовом поясе компании без внешних библиотек. */

/** Смещение пояса (мс) относительно UTC в момент `at`. */
export function tzOffsetMs(timeZone: string, at: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - (at - (at % 1000));
}

/** Момент «конец дня» (23:59:59.999) даты YYYY-MM-DD в поясе компании, epoch ms. */
export function endOfDayInZone(date: string, timeZone: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error("bad_date");
  const naiveUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
  let guess = naiveUtc - tzOffsetMs(timeZone, naiveUtc);
  guess = naiveUtc - tzOffsetMs(timeZone, guess); // повторная коррекция при смене смещения
  return guess;
}

/** Дата YYYY-MM-DD в поясе компании для момента `at`. */
export function dateInZone(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(at),
  );
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
