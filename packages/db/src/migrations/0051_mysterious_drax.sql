ALTER TABLE "agents" ADD COLUMN "current_activity" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "progress" integer DEFAULT 0 NOT NULL;