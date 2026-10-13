/**
 * ABG National Portal — database schema.
 *
 * The organisation is modelled generically so it survives structure changes
 * between terms and can be reused by other entities:
 *
 *   Term ─┬─ Body (entity | mc | lc | department | team | governance | support | oc | project | synergy)
 *         │    └─ Position (reports_to another Position, carries a role key + JD)
 *         │          └─ Assignment (User holds Position for a period)
 *
 * Nothing about "MCVP → LCVP" is hardcoded: reporting lines live in data.
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  date,
  numeric,
  uniqueIndex,
  index,
  primaryKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ───────────────────────────── Identity ─────────────────────────────

export const USER_STATUSES = ["candidate", "pending_first_login", "active", "alumni", "archived", "suspended"] as const;
export const USER_TYPES = ["internal", "partner", "boa", "alumni"] as const;
export const VISIBILITY = ["internal", "restricted", "private"] as const;

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    name: text("name").notNull(),
    preferredName: text("preferred_name"),
    phone: text("phone"),
    personalEmail: text("personal_email"),
    birthday: date("birthday"),
    emergencyContact: text("emergency_contact"),
    university: text("university"),
    location: text("location"),
    photoUrl: text("photo_url"),
    bio: text("bio"),
    linkedin: text("linkedin"),
    portfolio: text("portfolio"),
    skills: text("skills").array().notNull().default([]),
    languages: text("languages").array().notNull().default([]),
    status: text("status", { enum: USER_STATUSES }).notNull().default("active"),
    userType: text("user_type", { enum: USER_TYPES }).notNull().default("internal"),
    // Field-level visibility chosen by the user (restricted = own leadership chain + MC only)
    phoneVisibility: text("phone_visibility", { enum: VISIBILITY }).notNull().default("restricted"),
    personalEmailVisibility: text("personal_email_visibility", { enum: VISIBILITY }).notNull().default("restricted"),
    birthdayVisibility: text("birthday_visibility", { enum: VISIBILITY }).notNull().default("restricted"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    termsAcceptedAt: ts("terms_accepted_at"),
    profileCompletedAt: ts("profile_completed_at"),
    totpSecret: text("totp_secret"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: ts("locked_until"),
    joinedAt: date("joined_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token) — the raw token only lives in the cookie
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    mfaVerified: boolean("mfa_verified").notNull().default(false),
    ip: text("ip"),
    userAgent: text("user_agent"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const loginEvents = pgTable("login_events", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  success: boolean("success").notNull(),
  reason: text("reason"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
});

/** One-time tokens: account activation, password reset. Only the hash is stored. */
export const userTokens = pgTable("user_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["activation", "password_reset"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

/** Separation of duties: there is no single "see everything" role. */
export const SYSTEM_ROLES = ["system_admin", "im_admin", "mx_admin", "fnl_admin", "governance_admin", "recruitment_admin"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const systemRoles = pgTable(
  "system_roles",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: SYSTEM_ROLES }).notNull(),
    grantedById: uuid("granted_by_id").references(() => users.id),
    approvedById: uuid("approved_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

// ───────────────────────────── Organisation ─────────────────────────────

export const terms = pgTable("terms", {
  id: id(),
  code: text("code").notNull().unique(), // e.g. "26.27"
  name: text("name").notNull(), // e.g. "Term 2026.27"
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: text("status", { enum: ["planning", "active", "closed"] }).notNull().default("planning"),
  closedAt: ts("closed_at"),
  closedById: uuid("closed_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const BODY_TYPES = ["entity", "mc", "lc", "department", "team", "governance", "support", "oc", "project", "synergy"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const bodies = pgTable(
  "bodies",
  {
    id: id(),
    termId: uuid("term_id").notNull().references(() => terms.id),
    type: text("type", { enum: BODY_TYPES }).notNull(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    parentId: uuid("parent_id").references((): AnyPgColumn => bodies.id),
    /** Functional area (oGX, iCX, BD, MKT, FNL, MX, IM, OD, EwA…) — used for templates and cross-term comparison */
    departmentKey: text("department_key"),
    /** Stable identity across terms (e.g. "lc-dhaka-south", "mc-ogx") so 25.26 and 26.27 can be compared */
    lineageKey: text("lineage_key"),
    description: text("description"),
    /**
     * standard     → visible to members, the leadership chain above it and the MC team
     * confidential → visible to its own members and explicitly authorised roles only (e.g. governance boards)
     */
    visibility: text("visibility", { enum: ["standard", "confidential"] }).notNull().default("standard"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [index("bodies_term_idx").on(t.termId), index("bodies_parent_idx").on(t.parentId)],
);

/** Bodies a synergy team (or project) connects — leaders of linked bodies can see the synergy's tracker. */
export const bodyLinks = pgTable(
  "body_links",
  {
    bodyId: uuid("body_id").notNull().references(() => bodies.id, { onDelete: "cascade" }),
    linkedBodyId: uuid("linked_body_id").notNull().references(() => bodies.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.bodyId, t.linkedBodyId] })],
);

export const ROLE_KEYS = [
  "member", "tl", "lcvp", "lcp", "lca",
  "mcp", "mcvp", "mcd", "est",
  "ecb", "esc", "efb",
  "ocp", "ocvp", "oc_member",
  "project_lead", "project_member",
  "synergy_lead", "synergy_member",
  "boa", "partner",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type JobDescription = {
  purpose?: string;
  responsibilities?: string[];
  kpis?: string[];
  competencies?: { name: string; level: number }[];
  authorities?: string[];
  deliverables?: string[];
  workingRhythm?: string;
  evaluationCriteria?: string[];
};

export const positions = pgTable(
  "positions",
  {
    id: id(),
    bodyId: uuid("body_id").notNull().references(() => bodies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    roleKey: text("role_key", { enum: ROLE_KEYS }).notNull(),
    reportsToId: uuid("reports_to_id").references((): AnyPgColumn => positions.id),
    /** Leaders manage the body they sit in (and everything below it). */
    isLeader: boolean("is_leader").notNull().default(false),
    /** Allows several holders (e.g. "Member, oGX Team 1"). */
    multiHolder: boolean("multi_holder").notNull().default(false),
    jd: jsonb("jd").$type<JobDescription>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(100),
    createdAt: createdAt(),
  },
  (t) => [index("positions_body_idx").on(t.bodyId)],
);

export const assignments = pgTable(
  "assignments",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    positionId: uuid("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("assignments_user_idx").on(t.userId), index("assignments_position_idx").on(t.positionId)],
);

// ───────────────────────────── Files & documents ─────────────────────────────

export const files = pgTable("files", {
  id: id(),
  storageKey: text("storage_key").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  uploadedById: uuid("uploaded_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const DOC_CATEGORIES = [
  "strategy", "plan", "report", "numbers", "tracker_snapshot", "sop", "playbook", "template", "policy",
  "constitution", "mou", "contract", "minutes", "decision", "handover", "jd", "education", "case", "other",
] as const;

/**
 * Classification drives who can open a document. Archived documents keep their classification forever,
 * so the next MC sees last term's operational files but never HR or confidential material.
 */
export const CLASSIFICATIONS = [
  "internal", // every internal user
  "body", // members of the owning body (+ leadership chain + MC)
  "leadership", // leaders of the owning body chain + MC
  "mc", // MC team only
  "mcp", // MCP only
  "governance", // governance boards + MCP
  "confidential_hr", // MX admin + MCP + the person concerned
  "confidential_finance", // FNL admin + MCVP FNL + MCP
  "external", // also visible to partners / BOA
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const documents = pgTable(
  "documents",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    fileId: uuid("file_id").references(() => files.id),
    externalUrl: text("external_url"),
    termId: uuid("term_id").notNull().references(() => terms.id),
    bodyId: uuid("body_id").notNull().references(() => bodies.id),
    category: text("category", { enum: DOC_CATEGORIES }).notNull().default("other"),
    classification: text("classification", { enum: CLASSIFICATIONS }).notNull().default("body"),
    ownerId: uuid("owner_id").references(() => users.id),
    version: integer("version").notNull().default(1),
    supersedesId: uuid("supersedes_id").references((): AnyPgColumn => documents.id),
    tags: text("tags").array().notNull().default([]),
    expiresOn: date("expires_on"),
    allowDownload: boolean("allow_download").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("documents_term_body_idx").on(t.termId, t.bodyId)],
);

// ───────────────────────────── Trackers ─────────────────────────────

export type TrackerColumn = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "user" | "url" | "currency";
  options?: string[];
  required?: boolean;
};

/** A rollup turns tracker rows into a KPI actual (e.g. count rows where Stage ∈ {Approved, Realised}). */
export type TrackerRollup = {
  label: string;
  agg: "count" | "sum";
  column?: string;
  where?: { column: string; in: string[] };
};

export const trackers = pgTable(
  "trackers",
  {
    id: id(),
    bodyId: uuid("body_id").notNull().references(() => bodies.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id),
    name: text("name").notNull(),
    description: text("description"),
    templateKey: text("template_key"),
    columns: jsonb("columns").$type<TrackerColumn[]>().notNull(),
    rollups: jsonb("rollups").$type<TrackerRollup[]>().notNull().default([]),
    frozen: boolean("frozen").notNull().default(false),
    frozenAt: ts("frozen_at"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("trackers_body_idx").on(t.bodyId)],
);

export const trackerRows = pgTable(
  "tracker_rows",
  {
    id: id(),
    trackerId: uuid("tracker_id").notNull().references(() => trackers.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Record<string, string | number | null>>().notNull(),
    ownerId: uuid("owner_id").references(() => users.id),
    createdById: uuid("created_by_id").references(() => users.id),
    updatedById: uuid("updated_by_id").references(() => users.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("tracker_rows_tracker_idx").on(t.trackerId)],
);

// ───────────────────────────── KPIs ─────────────────────────────

export const kpis = pgTable(
  "kpis",
  {
    id: id(),
    bodyId: uuid("body_id").notNull().references(() => bodies.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id),
    /** Optional: an individual KPI for one person */
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("count"),
    target: numeric("target", { mode: "number" }).notNull(),
    /** manual = entries; tracker = rollup of a tracker; tasks = KPI-linked task contributions (also entries) */
    source: text("source", { enum: ["manual", "tracker"] }).notNull().default("manual"),
    trackerId: uuid("tracker_id").references(() => trackers.id, { onDelete: "set null" }),
    rollupIndex: integer("rollup_index"),
    departmentKey: text("department_key"),
    /** Stable key for cross-term comparison, e.g. "ogx.approvals" */
    metricKey: text("metric_key"),
    createdAt: createdAt(),
  },
  (t) => [index("kpis_body_idx").on(t.bodyId)],
);

export const kpiEntries = pgTable(
  "kpi_entries",
  {
    id: id(),
    kpiId: uuid("kpi_id").notNull().references(() => kpis.id, { onDelete: "cascade" }),
    value: numeric("value", { mode: "number" }).notNull(),
    occurredOn: date("occurred_on").notNull(),
    source: text("source", { enum: ["manual", "task", "import", "automation"] }).notNull().default("manual"),
    taskId: uuid("task_id"),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("kpi_entries_kpi_idx").on(t.kpiId)],
);

// ───────────────────────────── Tasks ─────────────────────────────

export const TASK_STATUSES = ["not_started", "in_progress", "blocked", "submitted", "completed", "rejected"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export const BLOCK_REASONS = [
  "Waiting for another person", "Waiting for partner", "Lack of resources", "Technical issue",
  "Unclear instruction", "Personal emergency", "Other",
] as const;

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    termId: uuid("term_id").notNull().references(() => terms.id),
    title: text("title").notNull(),
    description: text("description"),
    createdById: uuid("created_by_id").notNull().references(() => users.id),
    assigneeId: uuid("assignee_id").notNull().references(() => users.id),
    reviewerId: uuid("reviewer_id").references(() => users.id),
    bodyId: uuid("body_id").references(() => bodies.id),
    /** Optional link to a project body */
    projectId: uuid("project_id").references(() => bodies.id),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id),
    recurringId: uuid("recurring_id"),
    priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("not_started"),
    dueAt: ts("due_at"),
    requireAck: boolean("require_ack").notNull().default(false),
    acknowledgedAt: ts("acknowledged_at"),
    blockedCategory: text("blocked_category"),
    blockedReason: text("blocked_reason"),
    kpiId: uuid("kpi_id").references(() => kpis.id, { onDelete: "set null" }),
    kpiContribution: numeric("kpi_contribution", { mode: "number" }),
    /** Assignment notifies intermediate leaders when an MC member assigns across levels */
    notifyChain: boolean("notify_chain").notNull().default(false),
    category: text("category", { enum: ["work", "onboarding", "report", "handover"] }).notNull().default("work"),
    startedAt: ts("started_at"),
    submittedAt: ts("submitted_at"),
    completedAt: ts("completed_at"),
    /** Highest reminder / escalation stage already sent — makes the automation idempotent */
    reminderStage: text("reminder_stage"),
    escalationLevel: integer("escalation_level").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_creator_idx").on(t.createdById),
    index("tasks_body_idx").on(t.bodyId),
  ],
);

export const taskEvents = pgTable(
  "task_events",
  {
    id: id(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id),
    type: text("type").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("task_events_task_idx").on(t.taskId)],
);

export const taskComments = pgTable("task_comments", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const taskAttachments = pgTable("task_attachments", {
  id: id(),
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").references(() => files.id),
  url: text("url"),
  label: text("label").notNull(),
  addedById: uuid("added_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const recurringTasks = pgTable("recurring_tasks", {
  id: id(),
  title: text("title").notNull(),
  description: text("description"),
  createdById: uuid("created_by_id").notNull().references(() => users.id),
  /** Assigned to whoever currently holds this position — survives handovers */
  positionId: uuid("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
  cadence: text("cadence", { enum: ["daily", "weekly", "monthly"] }).notNull(),
  weekday: integer("weekday"), // 0 = Sunday
  dayOfMonth: integer("day_of_month"),
  dueHour: integer("due_hour").notNull().default(23),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
  active: boolean("active").notNull().default(true),
  lastGeneratedOn: date("last_generated_on"),
  createdAt: createdAt(),
});

// ───────────────────────────── Daily work ─────────────────────────────

export const dailyUpdates = pgTable(
  "daily_updates",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    accomplished: text("accomplished").notNull(),
    workingOn: text("working_on"),
    blockers: text("blockers"),
    supportNeeded: text("support_needed"),
    tomorrow: text("tomorrow"),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("daily_updates_user_date_uq").on(t.userId, t.date)],
);

export const attendance = pgTable(
  "attendance",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    checkInAt: ts("check_in_at").notNull(),
    checkOutAt: ts("check_out_at"),
    method: text("method", { enum: ["manual", "event_qr"] }).notNull().default("manual"),
    eventId: uuid("event_id"),
  },
  (t) => [index("attendance_user_date_idx").on(t.userId, t.date)],
);

// ───────────────────────────── Communication ─────────────────────────────

export const AUDIENCES = ["national", "body", "leadership", "external"] as const;

export const announcements = pgTable("announcements", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: uuid("author_id").notNull().references(() => users.id),
  audience: text("audience", { enum: AUDIENCES }).notNull().default("national"),
  /** For audience=body / leadership: the body subtree targeted */
  bodyId: uuid("body_id").references(() => bodies.id),
  priority: text("priority", { enum: ["critical", "important", "normal", "info"] }).notNull().default("normal"),
  startsAt: ts("starts_at").notNull().defaultNow(),
  expiresAt: ts("expires_at"),
  requireAck: boolean("require_ack").notNull().default(false),
  createdAt: createdAt(),
});

export const announcementAcks = pgTable(
  "announcement_acks",
  {
    announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    ackAt: ts("ack_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] })],
);

export const posts = pgTable("posts", {
  id: id(),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  kind: text("kind", { enum: ["update", "achievement", "opportunity", "event", "knowledge"] }).notNull().default("update"),
  audience: text("audience", { enum: AUDIENCES }).notNull().default("national"),
  bodyId: uuid("body_id").references(() => bodies.id),
  linkUrl: text("link_url"),
  createdAt: createdAt(),
});

export const postReactions = pgTable(
  "post_reactions",
  {
    postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["like", "celebrate"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId, t.kind] })],
);

export const postComments = pgTable("post_comments", {
  id: id(),
  postId: uuid("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const NOTIFICATION_PRIORITIES = ["critical", "important", "normal", "info"] as const;

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    priority: text("priority", { enum: NOTIFICATION_PRIORITIES }).notNull().default("normal"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    /** Prevents the automation engine from sending the same reminder twice */
    dedupeKey: text("dedupe_key"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId), uniqueIndex("notifications_dedupe_uq").on(t.dedupeKey)],
);

/** Per-user channel preferences. Absent row = defaults from lib/notify.ts. */
export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    email: boolean("email").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const emailOutbox = pgTable("email_outbox", {
  id: id(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  status: text("status", { enum: ["queued", "sent", "failed", "logged"] }).notNull().default("queued"),
  error: text("error"),
  sentAt: ts("sent_at"),
  createdAt: createdAt(),
});

// ───────────────────────────── People processes ─────────────────────────────

export const leaveRequests = pgTable("leave_requests", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  category: text("category").notNull(),
  reason: text("reason"),
  handover: text("handover"),
  backupUserId: uuid("backup_user_id").references(() => users.id),
  approverId: uuid("approver_id").references(() => users.id),
  status: text("status", { enum: ["pending", "approved", "rejected", "cancelled"] }).notNull().default("pending"),
  decidedById: uuid("decided_by_id").references(() => users.id),
  decidedAt: ts("decided_at"),
  decisionNote: text("decision_note"),
  createdAt: createdAt(),
});

export const BADGES = ["Top Contributor", "Consistency King", "Innovator", "Team Player", "Exchange Champion", "Growth Champion", "Culture Champion"] as const;

export const recognitions = pgTable("recognitions", {
  id: id(),
  fromId: uuid("from_id").notNull().references(() => users.id),
  toId: uuid("to_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  badge: text("badge"),
  createdAt: createdAt(),
});

export const reviews = pgTable("reviews", {
  id: id(),
  subjectId: uuid("subject_id").notNull().references(() => users.id),
  reviewerId: uuid("reviewer_id").notNull().references(() => users.id),
  termId: uuid("term_id").notNull().references(() => terms.id),
  kind: text("kind", { enum: ["self", "manager", "peer", "direct_report"] }).notNull(),
  scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
  strengths: text("strengths"),
  developmentAreas: text("development_areas"),
  goals: text("goals"),
  sharedWithSubject: boolean("shared_with_subject").notNull().default(false),
  createdAt: createdAt(),
});

// ───────────────────────────── Events & calendar ─────────────────────────────

export const events = pgTable("events", {
  id: id(),
  title: text("title").notNull(),
  description: text("description"),
  kind: text("kind", { enum: ["meeting", "education", "conference", "recruitment", "deadline", "partner", "global", "social"] }).notNull().default("meeting"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at"),
  venue: text("venue"),
  /** Organising body (an OC, an LC, a team…) */
  bodyId: uuid("body_id").references(() => bodies.id),
  audience: text("audience", { enum: AUDIENCES }).notNull().default("body"),
  /** Secret embedded in the attendance QR code — rotates per event */
  checkinCode: text("checkin_code"),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const eventAttendance = pgTable(
  "event_attendance",
  {
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

// ───────────────────────────── Knowledge & ideas ─────────────────────────────

export const cases = pgTable("cases", {
  id: id(),
  kind: text("kind", { enum: ["good_case", "lesson"] }).notNull(),
  title: text("title").notNull(),
  context: text("context").notNull(),
  approach: text("approach").notNull(), // solution / what we tried
  outcome: text("outcome").notNull(), // results / what went wrong
  rootCause: text("root_cause"),
  recommendations: text("recommendations"), // lessons / what we'd do differently
  metrics: text("metrics"),
  tags: text("tags").array().notNull().default([]),
  departmentKey: text("department_key"),
  termId: uuid("term_id").notNull().references(() => terms.id),
  bodyId: uuid("body_id").references(() => bodies.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: createdAt(),
});

export const IDEA_STATUSES = ["submitted", "review", "accepted", "pilot", "implemented", "scaled", "declined"] as const;

export const ideas = pgTable("ideas", {
  id: id(),
  title: text("title").notNull(),
  problem: text("problem").notNull(),
  idea: text("idea").notNull(),
  impact: text("impact"),
  resources: text("resources"),
  departmentKey: text("department_key"),
  authorId: uuid("author_id").notNull().references(() => users.id),
  status: text("status", { enum: IDEA_STATUSES }).notNull().default("submitted"),
  createdAt: createdAt(),
});

export const ideaVotes = pgTable(
  "idea_votes",
  {
    ideaId: uuid("idea_id").notNull().references(() => ideas.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.ideaId, t.userId] })],
);

// ───────────────────────────── Governance ─────────────────────────────

export const decisions = pgTable("decisions", {
  id: id(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  termId: uuid("term_id").notNull().references(() => terms.id),
  bodyId: uuid("body_id").notNull().references(() => bodies.id),
  decidedById: uuid("decided_by_id").references(() => users.id),
  responsibleId: uuid("responsible_id").references(() => users.id),
  deadline: date("deadline"),
  status: text("status", { enum: ["open", "in_progress", "done", "reversed"] }).notNull().default("open"),
  decidedOn: date("decided_on").notNull(),
  createdAt: createdAt(),
});

export const motions = pgTable("motions", {
  id: id(),
  code: text("code").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  termId: uuid("term_id").notNull().references(() => terms.id),
  /** Voters are the active holders of positions in this body (e.g. ECB) */
  bodyId: uuid("body_id").notNull().references(() => bodies.id),
  quorum: integer("quorum").notNull(),
  closesAt: ts("closes_at").notNull(),
  status: text("status", { enum: ["open", "passed", "rejected", "no_quorum"] }).notNull().default("open"),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const votes = pgTable(
  "votes",
  {
    motionId: uuid("motion_id").notNull().references(() => motions.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id),
    choice: text("choice", { enum: ["approve", "reject", "abstain"] }).notNull(),
    castAt: ts("cast_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.motionId, t.userId] })],
);

export const handovers = pgTable("handovers", {
  id: id(),
  positionId: uuid("position_id").notNull().references(() => positions.id),
  fromUserId: uuid("from_user_id").notNull().references(() => users.id),
  toUserId: uuid("to_user_id").references(() => users.id),
  checklist: jsonb("checklist").$type<{ key: string; label: string; done: boolean; notes?: string }[]>().notNull(),
  notes: text("notes"),
  status: text("status", { enum: ["draft", "submitted", "accepted"] }).notNull().default("draft"),
  submittedAt: ts("submitted_at"),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

// ───────────────────────────── Recruitment → onboarding ─────────────────────────────

export const CANDIDATE_STATUSES = [
  "applied", "shortlisted", "assessed", "interviewed", "selected",
  "offer_generated", "offer_sent", "offer_viewed", "offer_accepted",
  "nda_pending", "nda_signed", "account_created", "account_activated",
  "onboarding_in_progress", "onboarding_completed", "active",
  "rejected", "offer_declined", "offer_expired", "nda_declined", "withdrawn",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const candidates = pgTable("candidates", {
  id: id(),
  fullName: text("full_name").notNull(),
  preferredName: text("preferred_name"),
  email: text("email").notNull(),
  phone: text("phone"),
  termId: uuid("term_id").notNull().references(() => terms.id),
  positionId: uuid("position_id").references(() => positions.id),
  reportingUserId: uuid("reporting_user_id").references(() => users.id),
  startDate: date("start_date"),
  offerExpiresOn: date("offer_expires_on"),
  status: text("status", { enum: CANDIDATE_STATUSES }).notNull().default("applied"),
  selectedAt: ts("selected_at"),
  userId: uuid("user_id").references(() => users.id),
  notes: text("notes"),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const candidateEvents = pgTable("candidate_events", {
  id: id(),
  candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  note: text("note"),
  actorId: uuid("actor_id").references(() => users.id),
  createdAt: createdAt(),
});

/** Versioned templates — a new version is a new row; old offers keep pointing at the version they were sent with. */
export const TEMPLATE_KINDS = [
  "offer_letter", "nda", "email_offer", "email_offer_reminder", "email_activation", "email_welcome", "email_onboarding_complete",
] as const;

export const templates = pgTable(
  "templates",
  {
    id: id(),
    kind: text("kind", { enum: TEMPLATE_KINDS }).notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    active: boolean("active").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("templates_kind_version_uq").on(t.kind, t.version)],
);

export const offers = pgTable("offers", {
  id: id(),
  code: text("code").notNull().unique(), // AIESEC-BD-26-27-000145
  candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").notNull().references(() => templates.id),
  renderedBody: text("rendered_body").notNull(),
  contentSha256: text("content_sha256").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: ts("expires_at").notNull(),
  status: text("status", { enum: ["generated", "sent", "viewed", "accepted", "declined", "expired", "revoked"] }).notNull().default("generated"),
  sentAt: ts("sent_at"),
  viewedAt: ts("viewed_at"),
  decidedAt: ts("decided_at"),
  declineReason: text("decline_reason"),
  decisionMeta: jsonb("decision_meta").$type<Record<string, string | null>>(),
  remindersSent: integer("reminders_sent").notNull().default(0),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: createdAt(),
});

export const ndaSignatures = pgTable("nda_signatures", {
  id: id(),
  candidateId: uuid("candidate_id").references(() => candidates.id),
  userId: uuid("user_id").references(() => users.id),
  templateId: uuid("template_id").notNull().references(() => templates.id),
  contentSha256: text("content_sha256").notNull(),
  signedName: text("signed_name").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  signedAt: ts("signed_at").notNull().defaultNow(),
});

export const onboardingItems = pgTable(
  "onboarding_items",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    doneAt: ts("done_at"),
  },
  (t) => [uniqueIndex("onboarding_user_key_uq").on(t.userId, t.key)],
);

// ───────────────────────────── Security & audit ─────────────────────────────

/** Two-person rule for critical operations (role grants, bulk exports, top-position changes). */
export const approvalRequests = pgTable("approval_requests", {
  id: id(),
  action: text("action", { enum: ["grant_system_role", "revoke_system_role", "bulk_export", "assign_position"] }).notNull(),
  payload: jsonb("payload").$type<Record<string, string>>().notNull(),
  reason: text("reason").notNull(),
  requestedById: uuid("requested_by_id").notNull().references(() => users.id),
  decidedById: uuid("decided_by_id").references(() => users.id),
  status: text("status", { enum: ["pending", "approved", "rejected", "executed"] }).notNull().default("pending"),
  decidedAt: ts("decided_at"),
  createdAt: createdAt(),
});

/**
 * Append-only, hash-chained audit log. Each row's hash covers the previous row's hash,
 * so editing or deleting history breaks the chain (verifiable in Admin → Audit).
 * Private message contents are never written here.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    seq: integer("seq").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("audit_seq_uq").on(t.seq)],
);

// ───────────────────────────── Configuration ─────────────────────────────

/** Admin-editable configuration (thresholds, schedules) — changed in Admin → Automation without code changes. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedById: uuid("updated_by_id").references(() => users.id),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** One row per automation run, for the admin "last runs" view. */
export const jobRuns = pgTable("job_runs", {
  id: id(),
  trigger: text("trigger").notNull(),
  result: jsonb("result").$type<Record<string, number | string>>().notNull(),
  startedAt: ts("started_at").notNull(),
  finishedAt: ts("finished_at").notNull(),
});
