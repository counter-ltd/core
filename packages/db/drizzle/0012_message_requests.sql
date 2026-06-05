ALTER TABLE "users" ADD COLUMN "messaging_privacy" text NOT NULL DEFAULT 'everyone';
ALTER TABLE "conversations" ADD COLUMN "status" text NOT NULL DEFAULT 'active';
ALTER TABLE "conversations" ADD COLUMN "requested_by" uuid;
--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
