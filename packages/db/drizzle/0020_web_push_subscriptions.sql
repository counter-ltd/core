CREATE TABLE IF NOT EXISTS "web_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"endpoint" text NOT NULL,
	"endpoint_index" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "web_push_subscriptions_endpoint_idx" ON "web_push_subscriptions" USING btree ("endpoint_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "web_push_subscriptions_user_id_idx" ON "web_push_subscriptions" USING btree ("user_id");
