ALTER TABLE "cases" ADD COLUMN "pool" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "hold_new_disputes_for_demo" boolean DEFAULT true NOT NULL;