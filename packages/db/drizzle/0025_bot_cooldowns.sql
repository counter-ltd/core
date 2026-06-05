-- Per-(user, bot) cooldown for mention replies.
--
-- One row per pair, stamped to now the moment a reply is decided, so a burst of
-- mentions inside the window can't each trigger a reply. Cheap abuse/cost guard.

CREATE TABLE "bot_cooldowns" (
	"user_id" uuid NOT NULL,
	"bot_id" uuid NOT NULL,
	"last_replied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_cooldowns_user_id_bot_id_pk" PRIMARY KEY("user_id","bot_id")
);
--> statement-breakpoint
ALTER TABLE "bot_cooldowns" ADD CONSTRAINT "bot_cooldowns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_cooldowns" ADD CONSTRAINT "bot_cooldowns_bot_id_users_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
