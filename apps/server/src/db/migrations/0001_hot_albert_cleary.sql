ALTER TABLE "action_log" ADD COLUMN "undone_by" uuid;--> statement-breakpoint
ALTER TABLE "action_log" ADD COLUMN "undone_via" text;--> statement-breakpoint
ALTER TABLE "action_log" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "action_log" ADD CONSTRAINT "action_log_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;