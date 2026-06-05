CREATE TABLE "device_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_keys_user_device_idx" ON "device_keys" USING btree ("user_id","device_id");--> statement-breakpoint
CREATE INDEX "device_keys_user_id_idx" ON "device_keys" USING btree ("user_id");--> statement-breakpoint
INSERT INTO "device_keys" ("user_id", "device_id", "public_key")
SELECT "id", 'legacy', "public_key"
FROM "users"
WHERE "public_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "public_key";
