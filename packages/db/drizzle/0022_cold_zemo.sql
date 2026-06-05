CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"ref_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_referenced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_objects_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "discord_profiles" (
	"discord_user_id" text PRIMARY KEY NOT NULL,
	"avatar_hash" text,
	"object_id" uuid,
	"username" text,
	"global_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "object_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_object_id" uuid;--> statement-breakpoint
ALTER TABLE "discord_profiles" ADD CONSTRAINT "discord_profiles_object_id_media_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_object_id_media_objects_id_fk" FOREIGN KEY ("object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_object_id_media_objects_id_fk" FOREIGN KEY ("avatar_object_id") REFERENCES "public"."media_objects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_objects_gc_idx" ON "media_objects" USING btree ("ref_count","last_referenced_at");
