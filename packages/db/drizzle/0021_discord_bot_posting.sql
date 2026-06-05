-- Add posting_enabled to discord_bot_subscriptions.
--
-- Separate from the notification opt-in (enabled): a user can receive
-- Counter notifications via Discord without allowing the bot to post on
-- their behalf, and vice versa. Off by default until the user explicitly
-- enables it in settings.

ALTER TABLE "discord_bot_subscriptions" ADD COLUMN "posting_enabled" boolean DEFAULT false NOT NULL;
