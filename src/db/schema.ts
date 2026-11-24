import { boolean, integer, jsonb, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const portalState = pgTable("portal_state", {
  id: text("id").primaryKey(),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  designation: text("designation").notNull(),
  department: text("department").notNull(),
  role: text("role").notNull().default("member"),
  reportingAdminId: text("reporting_admin_id"),
  active: boolean("active").notNull().default(true),
  dailyVision: text("daily_vision"),
  avatarColor: text("avatar_color").notNull().default("#8B5CF6"),
  avatarUrl: text("avatar_url"),
  casualBalance: integer("casual_balance").notNull().default(12),
  sickBalance: integer("sick_balance").notNull().default(10),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  assigneeId: text("assignee_id").notNull(),
  assignedById: text("assigned_by_id").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("assigned"),
  cadence: text("cadence").notNull().default("today"),
  startDate: text("start_date").notNull(),
  dueDate: text("due_date").notNull(),
  requiredProof: text("required_proof").notNull().default("any"),
  proofs: jsonb("proofs").notNull().default([]),
  comments: jsonb("comments").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  completedAt: text("completed_at"),
});

export const attendance = pgTable("attendance", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  punchIn: text("punch_in"),
  punchOut: text("punch_out"),
  hours: numeric("hours", { precision: 5, scale: 2 }).notNull().default("0"),
});

export const eodReports = pgTable("eod_reports", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  date: text("date").notNull(),
  worked: text("worked").notNull(),
  completed: text("completed").notNull(),
  blockers: text("blockers").notNull().default(""),
  hours: numeric("hours", { precision: 5, scale: 2 }).notNull().default("0"),
  taskIds: jsonb("task_ids").notNull().default([]),
  submittedAt: text("submitted_at").notNull(),
});

export const leaves = pgTable("leaves", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull().default("casual"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  halfDay: boolean("half_day").notNull().default(false),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  adminComment: text("admin_comment").notNull().default(""),
  emergencyContact: text("emergency_contact"),
  createdAt: text("created_at").notNull(),
});

export const tickets = pgTable("tickets", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  subject: text("subject").notNull(),
  category: text("category").notNull().default("platform"),
  description: text("description").notNull(),
  priority: text("priority").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  createdById: text("created_by_id").notNull(),
  ownerId: text("owner_id"),
  createdAt: text("created_at").notNull(),
  comments: jsonb("comments").notNull().default([]),
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("direct"),
  participantIds: jsonb("participant_ids").notNull().default([]),
});

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  senderId: text("sender_id").notNull(),
  body: text("body").notNull(),
  at: text("at").notNull(),
  readBy: jsonb("read_by").notNull().default([]),
});

export const leads = pgTable("leads", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  source: text("source").notNull().default(""),
  uploadedById: text("uploaded_by_id").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  visibility: text("visibility").notNull().default("public"),
  locked: boolean("locked").notNull().default(false),
  records: integer("records").notNull().default(0),
  tags: jsonb("tags").notNull().default([]),
});

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  at: text("at").notNull(),
  read: boolean("read").notNull().default(false),
  href: text("href"),
});

export const awards = pgTable("awards", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  period: text("period").notNull(),
  reason: text("reason").notNull(),
  nominatedById: text("nominated_by_id").notNull(),
  quote: text("quote"),
  featured: boolean("featured").notNull().default(false),
});

export const userPresence = pgTable("user_presence", {
  userId: text("user_id").primaryKey(),
  status: text("status").notNull().default("On Desk"),
  isCustomStatus: boolean("is_custom_status").notNull().default(false),
  availableFor: text("available_for").notNull().default("1o1"),
  isCustomAvailability: boolean("is_custom_availability").notNull().default(false),
  availableFrom: text("available_from"),
  availableUntil: text("available_until"),
  updatedAt: text("updated_at").notNull(),
});

export const battalions = pgTable("battalions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: text("created_by").notNull(),
  memberIds: jsonb("member_ids").$type<string[]>().notNull().default([]),
  createdAt: text("created_at").notNull(),
});

export const userSmtpConfigs = pgTable("user_smtp_configs", {
  userId: text("user_id").primaryKey(),
  providerLabel: text("provider_label").notNull().default("Custom SMTP"),
  host: text("host").notNull().default(""),
  port: integer("port").notNull().default(587),
  encryption: text("encryption").notNull().default("starttls"),
  username: text("username").notNull().default(""),
  encryptedPassword: text("encrypted_password").notNull().default(""),
  fromName: text("from_name").notNull().default(""),
  fromEmail: text("from_email").notNull().default(""),
  replyTo: text("reply_to"),
  enabled: boolean("enabled").notNull().default(true),
  lastVerifiedAt: text("last_verified_at"),
  lastTestStatus: text("last_test_status"),
  lastTestError: text("last_test_error"),
  teamsWebhookEncrypted: text("teams_webhook_encrypted"),
  teamsEnabled: boolean("teams_enabled").notNull().default(false),
  teamsLastVerifiedAt: text("teams_last_verified_at"),
  teamsLastTestStatus: text("teams_last_test_status"),
  teamsLastTestError: text("teams_last_test_error"),
  updatedAt: text("updated_at").notNull(),
});
