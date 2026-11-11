CREATE TABLE "actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"action" text NOT NULL,
	"request_id" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"actor" text NOT NULL,
	"approval_jti" text,
	"payload" jsonb,
	"response" jsonb,
	"debug_id" text,
	"error" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_tokens" (
	"jti" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"action" text NOT NULL,
	"draft_version" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"case_id" text,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"decision" text,
	"input_hash" text,
	"debug_id" text,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" text PRIMARY KEY NOT NULL,
	"dispute_id" text NOT NULL,
	"mode" text NOT NULL,
	"scenario" text,
	"reason" text,
	"paypal_status" text,
	"lifecycle_stage" text,
	"amount_value" numeric(12, 2),
	"amount_currency" text,
	"seller_response_due_date" timestamp with time zone,
	"buyer_claim" text,
	"state" text DEFAULT 'NEW' NOT NULL,
	"verdict" text,
	"confidence" numeric(4, 3),
	"reasoning_summary" text,
	"analysis" jsonb,
	"ground_check" jsonb,
	"policy" jsonb,
	"draft_version" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"last_reminder_at" timestamp with time zone,
	"reminder_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cases_dispute_id_unique" UNIQUE("dispute_id")
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"case_id" text NOT NULL,
	"fact_id" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"tool" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"debug_id" text,
	"data" jsonb NOT NULL,
	CONSTRAINT "facts_case_id_fact_id_pk" PRIMARY KEY("case_id","fact_id")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"concede_cap" numeric(12, 2) DEFAULT 100 NOT NULL,
	"telegram_chat_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"endpoint" text,
	"debug_id" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_tokens" ADD CONSTRAINT "approval_tokens_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "actions_request_id_uq" ON "actions" USING btree ("request_id");