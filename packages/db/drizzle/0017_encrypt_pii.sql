-- Encrypt PII at rest: email, push tokens, and OAuth provider email.
--
-- users.email and devices.token move from plain text to AES-256-GCM ciphertext
-- (`v1:` envelope, written by the API). Ciphertext is randomised per write and
-- so can't be queried or made unique, so each gets a blind-index column holding
-- a deterministic keyed HMAC of the original value. The blind index carries the
-- uniqueness constraint and powers every lookup (login, signup, OAuth-link,
-- push upsert, deregister). oauth_accounts.provider_email is encrypted too but
-- needs no index, since it's display-only and never looked up by.
--
-- The old plain-text unique constraints are dropped. The new columns are NOT
-- NULL with no default, so this migration expects empty users/devices tables;
-- in local dev, reseed after running it (bun run db:seed).

-- users: swap the plain email unique constraint for a blind-index column.
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_index" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_index_unique" UNIQUE("email_index");--> statement-breakpoint

-- devices: the unique guarantee moves from the raw token to its blind index.
DROP INDEX "devices_token_idx";--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_token_unique";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "token_index" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_token_idx" ON "devices" USING btree ("token_index");
