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
  /**
   * Оформление по умолчанию. Акцент, логотип и шрифт директор меняет в
   * «Настройки системы → Компания»; остальные цвета — в app/globals.css.
   */
  logo: null as string | null,
  theme: {
    /** Акцентный цвет — только для главного действия, выбранного элемента и фокуса. */
    accent: "#2f5bea",
    background: "#f4f5f8",
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
    maxLoginFailures: 8,
    lockMinutes: 15,
    resetCodeTtlHours: 24,
    minPasswordLength: 8,
  },

  /** Кто кому ставит задачи и что видит. */
  rules: {
    /** Видимость задач коллег своего филиала для сотрудника. */
    employeeSeesColleagues: false,
    /** Постановщик сохраняет доступ к задаче после передачи другому исполнителю. */
    creatorKeepsAccess: true,
    /** Приёмка результата руководителем. false — «Сдать» сразу завершает задачу. */
    acceptanceEnabled: true,
    /** Скорость считается от начала работы (started) или от назначения (assigned). */
    speedFrom: "started" as "started" | "assigned",
    /** Для новой задачи по умолчанию обязателен текст результата при сдаче. */
    defaultRequiresResult: true,
    /** Для новой задачи по умолчанию обязательно вложение при сдаче. */
    defaultRequiresAttachment: false,
  },

  /** Статусы по умолчанию. Ключи не меняются, названия — можно. */
  statuses: [
    { key: "new", name: "Новая", category: "open" },
    { key: "in_progress", name: "В работе", category: "progress" },
    { key: "review", name: "На проверке", category: "review" },
    { key: "done", name: "Завершена", category: "done" },
  ] satisfies StatusConfig[],

  /**
   * Разрешённые переходы. Для отключённой приёмки см. transitionsWithoutAcceptance.
   * requires.result — переход сдаёт результат: открывается форма результата; текст и вложение
   * обязательны по правилам задачи (requiresResult / requiresAttachment).
   * requires.comment — обязателен комментарий (например, причина возврата).
   */
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


  files: {
    /** Максимальный размер одного вложения, байт. */
    maxSize: 20 * 1024 * 1024,
  },

  /** Значения по умолчанию; каждый участник меняет их в разделе «Уведомления». */
  notifications: {
    /** За сколько минут до срока напоминать: 15, 60, 180, 1440, 4320. */
    remindBeforeMinutes: [60, 1440],
    /** Рабочие дни компании (1 — пн … 7 — вс); директор меняет в «Настройки системы → Компания». */
    workDays: [1, 2, 3, 4, 5],
    quietHours: { enabled: true, from: "21:00", to: "08:00" },
  },

  assistant: {
    name: "Помощник",
    defaultModel: "gpt-4.1-mini",
    transcribeModel: "gpt-4o-mini-transcribe",
  },
};

export type CompanyConfig = typeof companyConfig;
