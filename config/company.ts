/**
 * Настройки компании по умолчанию.
 *
 * Шаблон подходит разным компаниям: название, оформление, оргструктура и правила
 * меняются здесь (или в «Настройках системы», которые сохраняются в таблице settings),
 * а не правкой кода. Значения ниже применяются при создании компании.
 */

export type RoleKey = "employee" | "manager" | "director";
export type TransitionActor = "assignee" | "creator" | "manager" | "director";
export type StatusCategory = "open" | "progress" | "review" | "done" | "cancelled";

export type StatusConfig = { key: string; name: string; category: StatusCategory };
export type TransitionConfig = {
  from: string;
  to: string;
  actors: TransitionActor[];
  requires?: { comment?: boolean; result?: boolean; attachment?: boolean; confirm?: string };
};

export const companyConfig = {
  /** Название по умолчанию; директор меняет при активации и в настройках. */
  name: "AI Management",
  /** Путь к логотипу в /public или null (тогда показывается монограмма). */
  logo: null as string | null,

  theme: {
    /** Акцентный цвет — только для главного действия, выбранного элемента и фокуса. */
    accent: "#2563eb",
    accentForeground: "#ffffff",
    /** Нейтральная светлая тема. */
    background: "#f7f7f8",
    surface: "#ffffff",
    text: "#18181b",
    mutedText: "#5b5b66",
    border: "#e4e4e7",
    danger: "#c62828",
    success: "#1f7a3d",
    warning: "#a15c00",
    radius: "0.625rem",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  },

  /** Часовой пояс компании. Срок наступает в конце указанного дня (23:59:59). */
  timezone: "Asia/Almaty",
  /** Язык интерфейса по умолчанию: ru | kk | en. */
  locale: "ru" as "ru" | "kk" | "en",

  invitations: {
    /** Срок жизни приглашения первого директора (часы). */
    ownerTtlHours: 72,
    /** Срок жизни обычного приглашения (часы). */
    memberTtlHours: 72,
    /** Руководитель филиала может приглашать сотрудников своего филиала. */
    managerCanInviteEmployees: true,
  },

  auth: {
    sessionTtlDays: 30,
    /** PBKDF2-SHA256. 100 000 — максимум, который разрешает Web Crypto в Cloudflare Workers. */
    pbkdf2Iterations: 100_000,
    maxLoginFailures: 8,
    lockMinutes: 15,
    resetCodeTtlHours: 24,
    minPasswordLength: 8,
  },

  /** Кто кому ставит задачи и что видит. */
  rules: {
    /** Видимость задач коллег своего филиала для сотрудника. */
    employeeSeesColleagues: false,
    /** Соисполнение (несколько исполнителей). */
    coExecution: false,
    /** Постановщик сохраняет доступ к задаче после передачи другому исполнителю. */
    creatorKeepsAccess: true,
    /** Приёмка результата руководителем. false — «Сдать» сразу завершает задачу. */
    acceptanceEnabled: true,
    /** Скорость считается от начала работы (started) или от назначения (assigned). */
    speedFrom: "started" as "started" | "assigned",
  },

  /** Статусы по умолчанию. Ключи не меняются, названия — можно. */
  statuses: [
    { key: "new", name: "Новая", category: "open" },
    { key: "in_progress", name: "В работе", category: "progress" },
    { key: "review", name: "На проверке", category: "review" },
    { key: "done", name: "Завершена", category: "done" },
  ] satisfies StatusConfig[],

  /** Разрешённые переходы. Для отключённой приёмки см. transitionsWithoutAcceptance. */
  transitions: [
    { from: "new", to: "in_progress", actors: ["assignee", "manager", "director"] },
    { from: "in_progress", to: "review", actors: ["assignee"], requires: { result: true } },
    { from: "review", to: "done", actors: ["manager", "director", "creator"] },
    { from: "review", to: "in_progress", actors: ["manager", "director", "creator"], requires: { comment: true } },
    { from: "in_progress", to: "new", actors: ["manager", "director"] },
    { from: "done", to: "in_progress", actors: ["manager", "director"], requires: { comment: true } },
  ] satisfies TransitionConfig[],

  transitionsWithoutAcceptance: [
    { from: "new", to: "in_progress", actors: ["assignee", "manager", "director"] },
    { from: "in_progress", to: "done", actors: ["assignee", "manager", "director"], requires: { result: true } },
    { from: "in_progress", to: "new", actors: ["manager", "director"] },
    { from: "done", to: "in_progress", actors: ["manager", "director"], requires: { comment: true } },
  ] satisfies TransitionConfig[],

  /** Дополнительные поля задачи (хранятся в extra_json). */
  extraFields: [] as { key: string; label: string; type: "text" | "number" | "date" }[],

  notifications: {
    /** За сколько часов до срока напоминать по умолчанию. */
    remindBeforeHours: [24, 2],
    workDays: [1, 2, 3, 4, 5],
    quietHours: { from: "21:00", to: "08:00" },
  },

  assistant: {
    name: "Помощник",
    defaultModel: "gpt-4.1-mini",
    transcribeModel: "gpt-4o-mini-transcribe",
  },
};

export type CompanyConfig = typeof companyConfig;
