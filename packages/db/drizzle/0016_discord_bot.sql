-- Thing Two Discord bot opt-in subscriptions.
--
-- One row per user who has ever interacted with the toggle. Absence means the
-- user has never enabled it. inGuild is a cached result of the bot API guild
-- membership check so we don't call Discord on every notification delivery.

CREATE TABLE "discord_bot_subscriptions" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"in_guild" boolean DEFAULT false NOT NULL,
	"guild_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_bot_subscriptions" ADD CONSTRAINT "discord_bot_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
