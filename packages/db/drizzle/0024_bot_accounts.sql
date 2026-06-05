-- Server-designated bot accounts.
--
-- Null for every normal (human) account. A non-null value (e.g. 'thing_one')
-- marks the account as a bot and names its persona; the mention-reply pipeline
-- keys off it. Only ever set server-side (migration, seed, or direct SQL),
-- never through any API surface, so the open API can't promote an account to a
-- bot. Bot accounts also cannot be DMed (enforced in the message route).

ALTER TABLE "users" ADD COLUMN "bot_kind" text;
