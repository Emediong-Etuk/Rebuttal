import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** LIVE cases talk to the real PayPal sandbox. REPLAY cases serve PayPal reads from a fixture and stub writes. */
export type CaseMode = "LIVE" | "REPLAY";

/** Rebuttal's own view of where a case is. PayPal's status is stored separately in `paypalStatus`. */
export type CaseState =
  | "NEW"
  | "ANALYSING"
  | "AWAITING_SELLER" // a recommendation is waiting for the seller's tap
  | "NEEDS_INPUT" // the seller must supply something (e.g. a tracking number)
  | "SUBMITTING"
  | "RESPONDED" // evidence/message sent, waiting for PayPal
  | "CONCEDED"
  | "MANUAL_REVIEW"
  | "RESOLVED"
  | "FAILED";

export const cases = pgTable("cases", {
  id: text("id").primaryKey(),
  disputeId: text("dispute_id").notNull().unique(),
  mode: text("mode").$type<CaseMode>().notNull(),
  scenario: text("scenario"),
  reason: text("reason"),
  paypalStatus: text("paypal_status"),
  lifecycleStage: text("lifecycle_stage"),
  amountValue: numeric("amount_value", { precision: 12, scale: 2 }),
  amountCurrency: text("amount_currency"),
  sellerResponseDueDate: timestamp("seller_response_due_date", { withTimezone: true }),
  buyerClaim: text("buyer_claim"),
  state: text("state").$type<CaseState>().notNull().default("NEW"),
  verdict: text("verdict"),
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  reasoningSummary: text("reasoning_summary"),
  analysis: jsonb("analysis"),
  groundCheck: jsonb("ground_check"),
  policy: jsonb("policy"),
  /** Incremented every time the pipeline produces a new draft; part of idempotency keys. */
  draftVersion: integer("draft_version").notNull().default(0),
  outcome: text("outcome"),
  /** Pre-filed real sandbox disputes held for the public demo until a visitor claims one. */
  pool: boolean("pool").notNull().default(false),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  reminderCount: integer("reminder_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every record fetched from PayPal (or supplied by the seller), with a stable ID the draft can cite. */
export const facts = pgTable(
  "facts",
  {
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    factId: text("fact_id").notNull(),
    kind: text("kind").notNull(),
    source: text("source").notNull(), // e.g. "GET /v1/customer/disputes/{id}" or "seller via Telegram"
    tool: text("tool"), // toolkit tool name, when fetched by the agent
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    debugId: text("debug_id"),
    data: jsonb("data").notNull(),
  },
  (t) => [primaryKey({ columns: [t.caseId, t.factId] })],
);

export const timelineEvents = pgTable("timeline_events", {
  id: serial("id").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  kind: text("kind").notNull(),
  actor: text("actor").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  endpoint: text("endpoint"),
  debugId: text("debug_id"),
  simulated: boolean("simulated").notNull().default(false),
  detail: jsonb("detail"),
});

/** Append-only. A trigger in the migration rejects UPDATE and DELETE. */
export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  caseId: text("case_id"),
  actor: text("actor").notNull(), // model | policy | seller | cron | system | paypal
  action: text("action").notNull(),
  decision: text("decision"),
  inputHash: text("input_hash"),
  debugId: text("debug_id"),
  data: jsonb("data"),
});

export const webhookEvents = pgTable("webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

export type ActionKind = "PROVIDE_EVIDENCE" | "SEND_MESSAGE" | "ACCEPT_CLAIM";

/**
 * One row per attempted PayPal write. The unique request ID (derived from case, action and draft version)
 * is what makes double taps, repeated webhooks and overlapping cron runs collapse into a single PayPal call.
 */
export const actions = pgTable(
  "actions",
  {
    id: serial("id").primaryKey(),
    caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
    action: text("action").$type<ActionKind>().notNull(),
    requestId: text("request_id").notNull(),
    status: text("status").$type<"PENDING" | "SUCCEEDED" | "FAILED">().notNull().default("PENDING"),
    actor: text("actor").notNull(),
    approvalJti: text("approval_jti"),
    payload: jsonb("payload"),
    response: jsonb("response"),
    debugId: text("debug_id"),
    error: text("error"),
    simulated: boolean("simulated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("actions_request_id_uq").on(t.requestId)],
);

export const approvalTokens = pgTable("approval_tokens", {
  jti: text("jti").primaryKey(),
  caseId: text("case_id").notNull().references(() => cases.id, { onDelete: "cascade" }),
  action: text("action").$type<ActionKind>().notNull(),
  draftVersion: integer("draft_version").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("default"),
  concedeCap: numeric("concede_cap", { precision: 12, scale: 2 }).notNull().default(sql`100`),
  telegramChatId: text("telegram_chat_id"),
  /** When true, newly created disputes are held in the demo pool instead of being answered at once. */
  holdNewDisputesForDemo: boolean("hold_new_disputes_for_demo").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Case = typeof cases.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type TimelineEvent = typeof timelineEvents.$inferSelect;
