/** Личные настройки уведомлений участника (таблица settings, scope = user). */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../db";

export const NOTIFY_EVENTS = ["assigned", "dueSoon", "overdue", "submitted", "returned", "accepted", "comment"] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];
/** Варианты «Напоминать до срока», минуты. */
export const REMIND_OPTIONS = [15, 60, 180, 1440, 4320] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time_invalid");

export const prefsSchema = z.object({
  channels: z.object({ whatsapp: z.boolean(), push: z.boolean() }),
  events: z.object(Object.fromEntries(NOTIFY_EVENTS.map((e) => [e, z.boolean()])) as Record<NotifyEvent, z.ZodBoolean>),
  remindBefore: z.array(z.number().int().refine((v) => (REMIND_OPTIONS as readonly number[]).includes(v))).max(REMIND_OPTIONS.length),
  quiet: z.object({ enabled: z.boolean(), from: time, to: time }),
  /** Только рабочие дни компании (для WhatsApp и push). */
  workDaysOnly: z.boolean(),
  pausedUntil: z.number().int().nullable(),
});

export type Prefs = z.infer<typeof prefsSchema>;

export const DEFAULT_PREFS: Prefs = {
  channels: { whatsapp: false, push: false },
  events: { assigned: true, dueSoon: true, overdue: true, submitted: true, returned: true, accepted: true, comment: true },
  remindBefore: [60, 1440],
  quiet: { enabled: true, from: "21:00", to: "08:00" },
  workDaysOnly: false,
  pausedUntil: null,
};

const KEY = "notifications";

export async function loadPrefs(userId: string): Promise<Prefs> {
  const row = await getDb().query.settings.findFirst({
    where: and(eq(schema.settings.scope, "user"), eq(schema.settings.scopeId, userId), eq(schema.settings.key, KEY)),
  });
  if (!row) return structuredClone(DEFAULT_PREFS);
  const parsed = prefsSchema.safeParse({ ...DEFAULT_PREFS, ...JSON.parse(row.valueJson) });
  return parsed.success ? parsed.data : structuredClone(DEFAULT_PREFS);
}

export async function savePrefs(userId: string, prefs: Prefs): Promise<void> {
  const now = Date.now();
  const valueJson = JSON.stringify(prefsSchema.parse(prefs));
  await getDb()
    .insert(schema.settings)
    .values({ scope: "user", scopeId: userId, key: KEY, valueJson, updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({ target: [schema.settings.scope, schema.settings.scopeId, schema.settings.key], set: { valueJson, updatedAt: now } });
}
