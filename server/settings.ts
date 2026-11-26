/**
 * Настройки компании: значения по умолчанию из config/company.ts,
 * переопределения — в таблице settings (scope = company). Меняются в «Настройках системы».
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { companyConfig } from "../config/company";
import { getDb, schema } from "./db";

export const ASSISTANT_MODELS = ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"] as const;

export const companySettingsSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "color_invalid"),
  logoUrl: z.union([z.literal(""), z.string().regex(/^\/api\/branding\/logo\?v=\d+$/, "url_invalid"), z.string().url("url_invalid").startsWith("https://", "url_invalid").max(500)]),
  fontFamily: z.string().trim().max(200).regex(/^[\w\s,"'-]*$/, "font_invalid"),
  /** Момент наступления срока, если указана только дата (HH:MM). */
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time_invalid"),
  /** Рабочие дни: 1 — понедельник … 7 — воскресенье. */
  workDays: z.array(z.number().int().min(1).max(7)).max(7),
  acceptanceEnabled: z.boolean(),
  employeeSeesColleagues: z.boolean(),
  speedFrom: z.enum(["started", "assigned"]),
  cancelledName: z.string().trim().min(1, "required").max(40),
  assistantName: z.string().trim().min(1, "required").max(40),
  assistantModel: z.enum(ASSISTANT_MODELS),
  /** Рабочий номер WhatsApp компании (подсказка сотрудникам при привязке номера). */
  whapiPhone: z.string().regex(/^\d{0,15}$/, "phone_invalid"),
  /** Инструкции помощника — одни и те же для WhatsApp и для чата на сайте. */
  assistantInstructions: z.string().trim().max(2000, "too_long"),
});

export type CompanySettings = z.infer<typeof companySettingsSchema>;

export const DEFAULT_SETTINGS: CompanySettings = {
  accent: companyConfig.theme.accent,
  logoUrl: companyConfig.logo ?? "",
  fontFamily: "",
  dueTime: "23:59",
  workDays: companyConfig.notifications.workDays,
  acceptanceEnabled: companyConfig.rules.acceptanceEnabled,
  employeeSeesColleagues: companyConfig.rules.employeeSeesColleagues,
  speedFrom: companyConfig.rules.speedFrom,
  cancelledName: "Отменена",
  assistantName: companyConfig.assistant.name,
  assistantModel: companyConfig.assistant.defaultModel as CompanySettings["assistantModel"],
  whapiPhone: "",
  assistantInstructions: "",
};

const KEY = "company";

export async function loadSettings(companyId: string): Promise<CompanySettings> {
  const row = await getDb().query.settings.findFirst({
    where: and(eq(schema.settings.scope, "company"), eq(schema.settings.scopeId, companyId), eq(schema.settings.key, KEY)),
  });
  if (!row) return { ...DEFAULT_SETTINGS };
  const parsed = companySettingsSchema.partial().safeParse(JSON.parse(row.valueJson));
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export async function saveSettings(companyId: string, patch: Partial<CompanySettings>, userId: string): Promise<CompanySettings> {
  const next = companySettingsSchema.parse({ ...(await loadSettings(companyId)), ...patch });
  const now = Date.now();
  await getDb()
    .insert(schema.settings)
    .values({ scope: "company", scopeId: companyId, key: KEY, valueJson: JSON.stringify(next), updatedBy: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: [schema.settings.scope, schema.settings.scopeId, schema.settings.key],
      set: { valueJson: JSON.stringify(next), updatedBy: userId, updatedAt: now },
    });
  return next;
}

/** Оформление для страниц без входа (вход, приглашение): установка рассчитана на одну компанию. */
export async function loadPublicBranding(): Promise<{ name: string; accent: string; logoUrl: string; fontFamily: string }> {
  try {
    const company = await getDb().query.companies.findFirst();
    if (!company) return { name: companyConfig.name, accent: DEFAULT_SETTINGS.accent, logoUrl: DEFAULT_SETTINGS.logoUrl, fontFamily: "" };
    const s = await loadSettings(company.id);
    return { name: company.name, accent: s.accent, logoUrl: s.logoUrl, fontFamily: s.fontFamily };
  } catch {
    return { name: companyConfig.name, accent: DEFAULT_SETTINGS.accent, logoUrl: "", fontFamily: "" };
  }
}
