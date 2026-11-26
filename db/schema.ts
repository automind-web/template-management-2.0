/**
 * Схема БД (Cloudflare D1 / SQLite) для AI Management.
 *
 * Правила:
 *  - Идентификаторы — текстовые UUID, не меняются при переименовании.
 *  - Время — целое число миллисекунд UTC (epoch ms).
 *  - Схема меняется ТОЛЬКО новыми миграциями (`npm run db:generate`).
 *    Применённые файлы в /drizzle не редактировать.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`;

// ---------- Компания, филиалы, пользователи ----------

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Almaty"),
  locale: text("locale").notNull().default("ru"),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

export const branches = sqliteTable(
  "branches",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    archivedAt: integer("archived_at"),
    createdBy: text("created_by"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [index("branches_company_idx").on(t.companyId)],
);

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    /** Логин в нижнем регистре, уникален во всей установке. */
    login: text("login").notNull(),
    displayName: text("display_name").notNull(),
    /** Формат: pbkdf2-sha256$<итерации>$<соль b64>$<хеш b64> */
    passwordHash: text("password_hash").notNull(),
    phone: text("phone"),
    phoneVerifiedAt: integer("phone_verified_at"),
    disabledAt: integer("disabled_at"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("users_login_unique").on(t.login), index("users_phone_idx").on(t.phone)],
);

/** Членство: роль пользователя в компании и (для сотрудника/руководителя) филиал. */
export const memberships = sqliteTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    companyId: text("company_id").notNull().references(() => companies.id),
    /** null у директора: он видит все филиалы компании. */
    branchId: text("branch_id").references(() => branches.id),
    role: text("role", { enum: ["employee", "manager", "director"] }).notNull(),
    position: text("position"),
    /** Руководитель может приглашать сотрудников своего филиала. */
    canInvite: integer("can_invite", { mode: "boolean" }).notNull().default(false),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("memberships_user_idx").on(t.userId),
    index("memberships_company_branch_idx").on(t.companyId, t.branchId),
  ],
);

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    /** owner — приглашение первого директора; member — обычное. */
    kind: text("kind", { enum: ["owner", "member"] }).notNull(),
    companyId: text("company_id").notNull().references(() => companies.id),
    branchId: text("branch_id").references(() => branches.id),
    role: text("role", { enum: ["employee", "manager", "director"] }).notNull(),
    /** SHA-256 от токена из ссылки. Сам токен в БД не хранится. */
    tokenHash: text("token_hash").notNull(),
    note: text("note"),
    createdBy: text("created_by"),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    usedBy: text("used_by"),
    revokedAt: integer("revoked_at"),
    revokedBy: text("revoked_by"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("invitations_token_unique").on(t.tokenHash), index("invitations_company_idx").on(t.companyId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    /** SHA-256 от значения cookie. */
    tokenHash: text("token_hash").notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull().default(now),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (t) => [uniqueIndex("sessions_token_unique").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Защита от перебора паролей и кодов. key = "login:<логин>" | "recover:<логин>" | "setup". */
export const authThrottle = sqliteTable("auth_throttle", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull().default(0),
  lockedUntil: integer("locked_until"),
  updatedAt: integer("updated_at").notNull().default(now),
});

/** Одноразовые коды восстановления пароля (код от директора или через WhatsApp). */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    codeHash: text("code_hash").notNull(),
    channel: text("channel", { enum: ["director", "whatsapp"] }).notNull(),
    createdBy: text("created_by"),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("password_resets_user_idx").on(t.userId)],
);

/** Одноразовые коды привязки номера WhatsApp. */
export const phoneLinkCodes = sqliteTable(
  "phone_link_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    code: text("code").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    phone: text("phone"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("phone_link_codes_code_unique").on(t.code)],
);

// ---------- Статусы и переходы (заполняются из config/company.ts при создании компании) ----------

export const taskStatuses = sqliteTable(
  "task_statuses",
  {
    companyId: text("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    sort: integer("sort").notNull(),
    /** open | review | done | cancelled */
    category: text("category", { enum: ["open", "progress", "review", "done", "cancelled"] }).notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.key] })],
);

export const statusTransitions = sqliteTable(
  "status_transitions",
  {
    companyId: text("company_id").notNull().references(() => companies.id),
    fromKey: text("from_key").notNull(),
    toKey: text("to_key").notNull(),
    /** JSON-массив ролей: ["assignee","manager","director","creator"]. */
    actorsJson: text("actors_json").notNull(),
    /** JSON: { comment?: boolean, result?: boolean, attachment?: boolean, confirm?: string } */
    requiresJson: text("requires_json").notNull().default("{}"),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.fromKey, t.toKey] })],
);

// ---------- Задачи ----------

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    branchId: text("branch_id").notNull().references(() => branches.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    resultCriteria: text("result_criteria"),
    statusKey: text("status_key").notNull(),
    assigneeId: text("assignee_id").notNull().references(() => users.id),
    creatorId: text("creator_id").notNull().references(() => users.id),
    isPersonal: integer("is_personal", { mode: "boolean" }).notNull().default(false),
    /** Дата срока YYYY-MM-DD в часовом поясе компании; null — «Без срока». */
    dueDate: text("due_date"),
    /** Время срока HH:MM в поясе компании; null — время по умолчанию из настроек компании. */
    dueTime: text("due_time"),
    /** Момент наступления срока (дата + время в поясе компании), epoch ms. */
    dueAt: integer("due_at"),
    requiresResult: integer("requires_result", { mode: "boolean" }).notNull().default(false),
    requiresAttachment: integer("requires_attachment", { mode: "boolean" }).notNull().default(false),
    checklistJson: text("checklist_json").notNull().default("[]"),
    extraJson: text("extra_json").notNull().default("{}"),
    version: integer("version").notNull().default(1),
    assignedAt: integer("assigned_at").notNull().default(now),
    startedAt: integer("started_at"),
    submittedAt: integer("submitted_at"),
    completedAt: integer("completed_at"),
    cancelledAt: integer("cancelled_at"),
    reopenCount: integer("reopen_count").notNull().default(0),
    /** Текст для поиска в нижнем регистре (SQLite lower() не понимает кириллицу). */
    searchText: text("search_text").notNull().default(""),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [
    index("tasks_company_branch_status_idx").on(t.companyId, t.branchId, t.statusKey),
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_due_idx").on(t.companyId, t.dueAt),
    uniqueIndex("tasks_company_number_unique").on(t.companyId, t.number),
  ],
);

/** История: каждое назначение, смена срока/статуса, решение по результату. */
export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    companyId: text("company_id").notNull(),
    branchId: text("branch_id").notNull(),
    actorId: text("actor_id"),
    /** created | assigned | due_changed | status_changed | accepted | returned | reopened | cancelled | field_changed | comment | attachment */
    type: text("type").notNull(),
    field: text("field"),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    comment: text("comment"),
    /** Снимок на момент события — для статистики «на момент среза». */
    assigneeId: text("assignee_id"),
    dueAt: integer("due_at"),
    statusKey: text("status_key"),
    channel: text("channel").notNull().default("web"),
    opId: text("op_id"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("task_events_task_idx").on(t.taskId, t.createdAt),
    index("task_events_company_time_idx").on(t.companyId, t.createdAt),
  ],
);

export const taskComments = sqliteTable(
  "task_comments",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    authorId: text("author_id").notNull().references(() => users.id),
    /** comment | result | return */
    kind: text("kind").notNull().default("comment"),
    body: text("body").notNull(),
    opId: text("op_id"),
    createdAt: integer("created_at").notNull().default(now),
    editedAt: integer("edited_at"),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId, t.createdAt)],
);

/** Метаданные файлов; содержимое — в R2 (привязка BUCKET). */
export const attachments = sqliteTable(
  "attachments",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id),
    branchId: text("branch_id"),
    taskId: text("task_id").references(() => tasks.id),
    commentId: text("comment_id"),
    uploaderId: text("uploader_id").notNull().references(() => users.id),
    objectKey: text("object_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    /** file | photo | result | voice */
    kind: text("kind").notNull().default("file"),
    deletedAt: integer("deleted_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("attachments_object_key_unique").on(t.objectKey), index("attachments_task_idx").on(t.taskId)],
);

/** Идемпотентность: повтор операции с тем же opId возвращает прежний результат. */
export const operations = sqliteTable("operations", {
  opId: text("op_id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  resultJson: text("result_json"),
  createdAt: integer("created_at").notNull().default(now),
});

// ---------- Настройки, интеграции, журнал ----------

/** Настройки уровня компании/филиала/пользователя (переопределяют config/company.ts). */
export const settings = sqliteTable(
  "settings",
  {
    scope: text("scope", { enum: ["company", "branch", "user"] }).notNull(),
    scopeId: text("scope_id").notNull(),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.scope, t.scopeId, t.key] })],
);

/** Подключения компании. Только несекретные параметры; токены — в секретах сайта. */
export const integrations = sqliteTable(
  "integrations",
  {
    companyId: text("company_id").notNull().references(() => companies.id),
    kind: text("kind", { enum: ["whapi", "openai", "push"] }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    configJson: text("config_json").notNull().default("{}"),
    lastStatus: text("last_status"),
    lastCheckedAt: integer("last_checked_at"),
    updatedBy: text("updated_by"),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.kind] })],
);

/** Журнал административных действий: приглашения, роли, филиалы, сессии. */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id"),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    dataJson: text("data_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("audit_events_company_idx").on(t.companyId, t.createdAt)],
);

// ---------- Помощник ----------

export const assistantThreads = sqliteTable(
  "assistant_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    channel: text("channel", { enum: ["web", "whatsapp"] }).notNull(),
    stateJson: text("state_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(now),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("assistant_threads_user_channel_unique").on(t.userId, t.channel)],
);

export const assistantMessages = sqliteTable(
  "assistant_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull().references(() => assistantThreads.id),
    role: text("role", { enum: ["user", "assistant", "tool", "system"] }).notNull(),
    content: text("content").notNull(),
    metaJson: text("meta_json").notNull().default("{}"),
    externalId: text("external_id"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("assistant_messages_thread_idx").on(t.threadId, t.createdAt)],
);

// ---------- Уведомления ----------

/** Очередь доставки (кабинет, WhatsApp, push). Обрабатывается при запросах и по расписанию. */
export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    taskId: text("task_id"),
    channel: text("channel", { enum: ["cabinet", "whatsapp", "push"] }).notNull(),
    event: text("event").notNull(),
    /** Ключ дедупликации: одно событие — одна доставка на канал. */
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    url: text("url"),
    scheduledAt: integer("scheduled_at").notNull(),
    /** pending | sending | sent | failed | cancelled */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lockedUntil: integer("locked_until"),
    sentAt: integer("sent_at"),
    readAt: integer("read_at"),
    error: text("error"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("notification_deliveries_dedupe_unique").on(t.dedupeKey),
    index("notification_deliveries_due_idx").on(t.status, t.scheduledAt),
    index("notification_deliveries_user_idx").on(t.userId, t.channel, t.createdAt),
  ],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    sessionId: text("session_id"),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_unique").on(t.endpoint)],
);

export type Role = "employee" | "manager" | "director";
