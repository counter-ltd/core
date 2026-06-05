-- Per-user clear and delete timestamps on conversations.
--
-- clearedAt: messages older than this timestamp are hidden for that participant.
-- deletedAt: the conversation is hidden from that participant's inbox entirely.
-- Both columns are nullable; null means the user hasn't cleared or deleted.

ALTER TABLE "conversations"
  ADD COLUMN "participant_a_cleared_at" timestamp with time zone,
  ADD COLUMN "participant_b_cleared_at" timestamp with time zone,
  ADD COLUMN "participant_a_deleted_at" timestamp with time zone,
  ADD COLUMN "participant_b_deleted_at" timestamp with time zone;
