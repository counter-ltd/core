-- Drop the bot_cooldowns table.
--
-- The on-Counter bot now guards against duplicate replies per-post (it never
-- answers the same post twice) instead of a per-user time window, which had
-- choked normal back-and-forth in a thread. The cooldown table is no longer used.

DROP TABLE IF EXISTS "bot_cooldowns";
