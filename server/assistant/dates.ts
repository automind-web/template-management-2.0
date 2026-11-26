/**
 * Разбор дат и времени на русском для помощника: «сегодня», «завтра», «в пятницу», «28.11»,
 * «28.11.2026», «2026-11-28», «через 3 дня», «в 18:00», «через 2 часа», «за 1 час».
 */
import { dateInZone, dueMomentInZone } from "../time.ts";

/** Регулярное выражение с границами слова для кириллицы (\b в JS работает только с латиницей). */
function w(pattern: string): RegExp {
  return new RegExp(pattern.replaceAll("\\b", "(?:(?<![\\p{L}\\d])|(?![\\p{L}\\d]))"), "u");
}

const WEEKDAYS: [string, number][] = [
  ["понедельник", 1],
  ["вторник", 2],
  ["сред[уа]", 3],
  ["четверг", 4],
  ["пятниц[уыа]", 5],
  ["суббот[уыа]", 6],
  ["воскресень[ея]", 7],
];

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export type ParsedDate = { date: string; time: string | null; match: string };

/** Ищет дату (и время) в тексте. today — YYYY-MM-DD в поясе компании. */
export function parseDate(text: string, today: string): ParsedDate | null {
  const t = text.toLowerCase().replaceAll("ё", "е");
  // Время ищется после удаления дат вида 28.11 / 28.11.2026, чтобы не спутать их с 28:11.
  const withoutDates = t.replace(/\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}\.\d{1,2}(?![:.]\d)/g, (s) => " ".repeat(s.length));
  const time = /(?<!\d)([01]?\d|2[0-3])[:.]([0-5]\d)(?!\d)/.exec(withoutDates);
  const hhmm = time ? `${time[1]!.padStart(2, "0")}:${time[2]}` : null;

  let m: RegExpExecArray | null;
  if ((m = w("\\bпослезавтра\\b").exec(t))) return { date: addDays(today, 2), time: hhmm, match: m[0] };
  if ((m = w("\\bзавтра\\b").exec(t))) return { date: addDays(today, 1), time: hhmm, match: m[0] };
  if ((m = w("\\bсегодня\\b").exec(t))) return { date: today, time: hhmm, match: m[0] };
  if ((m = w("\\bчерез\\s+(\\d{1,3})\\s*(?:дн[яей]*|день)\\b").exec(t))) return { date: addDays(today, Number(m[1])), time: hhmm, match: m[0] };
  if ((m = w("\\bчерез\\s+неделю\\b").exec(t))) return { date: addDays(today, 7), time: hhmm, match: m[0] };
  if ((m = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/.exec(t))) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: hhmm, match: m[0] };
  if ((m = /(?<![\d.])(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?![\d:])/.exec(t))) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const pad = (n: number) => String(n).padStart(2, "0");
      let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : Number(today.slice(0, 4));
      let date = `${year}-${pad(month)}-${pad(day)}`;
      if (!m[3] && date < today) date = `${++year}-${pad(month)}-${pad(day)}`;
      return { date, time: hhmm, match: m[0] };
    }
  }
  for (const [stem, dow] of WEEKDAYS) {
    if ((m = w(`\\b(?:в|во|к|на|до)?\\s*${stem}\\b`).exec(t))) {
      const delta = (dow - weekday(today) + 7) % 7 || 7;
      return { date: addDays(today, delta), time: hhmm, match: m[0].trim() };
    }
  }
  return null;
}

/** «через 2 часа», «через 30 минут» → момент; «за 1 час» → смещение до срока (минуты). */
export function parseRelative(text: string): { inMinutes?: number; beforeMinutes?: number } | null {
  const t = text.toLowerCase();
  const unit = (u: string) => (u.startsWith("мин") ? 1 : u.startsWith("ч") ? 60 : 1440);
  let m = w("\\bчерез\\s+(\\d{1,4})\\s*(минут[уы]?|мин|час(?:а|ов)?|ч)\\b").exec(t);
  if (m) return { inMinutes: Number(m[1]) * unit(m[2]!) };
  if (w("\\bчерез\\s+час\\b").test(t)) return { inMinutes: 60 };
  m = w("\\bза\\s+(\\d{1,4})\\s*(минут[уы]?|мин|час(?:а|ов)?|ч|дн(?:я|ей)?|день)\\b").exec(t);
  if (m) return { beforeMinutes: Number(m[1]) * unit(m[2]!) };
  if (w("\\bза\\s+час\\b").test(t)) return { beforeMinutes: 60 };
  if (w("\\bза\\s+день\\b").test(t)) return { beforeMinutes: 1440 };
  return null;
}

export function momentOf(parsed: ParsedDate, defaultTime: string, timeZone: string): number {
  return dueMomentInZone(parsed.date, parsed.time ?? defaultTime, timeZone);
}

export function todayIn(timeZone: string): string {
  return dateInZone(Date.now(), timeZone);
}

export { w as wordRegExp };
