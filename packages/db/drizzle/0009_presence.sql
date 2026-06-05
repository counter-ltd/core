ALTER TABLE "users" ADD COLUMN "online_status_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "online_status_visibility" text NOT NULL DEFAULT 'everyone';
ALTER TABLE "users" ADD COLUMN "last_seen_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "last_seen_visibility" text NOT NULL DEFAULT 'everyone';
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;
ALTER TABLE "users" ADD COLUMN "heartbeat_interval_seconds" integer NOT NULL DEFAULT 300;
