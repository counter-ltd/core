-- Tunnel Talk: P2P ephemeral chat sessions with opt-in transcript saving.
--
-- tunnel_sessions: one row per invite/session pair. SDP/ICE signals are never
-- stored here; they pass through the signaling Durable Object ephemerally.
--
-- tunnel_messages: transcript rows uploaded in batch after session end, only
-- when both parties consented. CASCADE DELETE is the revocation mechanism.
--
-- messages.tunnel_session_id: links 'tunnel_started' and 'tunnel_ended' kind
-- rows to their session so the thread view can look up the transcript.

CREATE TABLE "tunnel_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"initiator_id" uuid,
	"participant_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"initiator_consent" boolean DEFAULT false NOT NULL,
	"participant_consent" boolean DEFAULT false NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tunnel_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tunnel_session_id" uuid NOT NULL,
	"sender_id" uuid,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tunnel_session_id" uuid;
--> statement-breakpoint
ALTER TABLE "tunnel_sessions" ADD CONSTRAINT "tunnel_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tunnel_sessions" ADD CONSTRAINT "tunnel_sessions_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tunnel_sessions" ADD CONSTRAINT "tunnel_sessions_participant_id_users_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tunnel_messages" ADD CONSTRAINT "tunnel_messages_tunnel_session_id_tunnel_sessions_id_fk" FOREIGN KEY ("tunnel_session_id") REFERENCES "public"."tunnel_sessions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tunnel_messages" ADD CONSTRAINT "tunnel_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tunnel_session_id_tunnel_sessions_id_fk" FOREIGN KEY ("tunnel_session_id") REFERENCES "public"."tunnel_sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tunnel_sessions_conversation_status_idx" ON "tunnel_sessions" USING btree ("conversation_id","status");
--> statement-breakpoint
CREATE INDEX "tunnel_sessions_initiator_idx" ON "tunnel_sessions" USING btree ("initiator_id");
--> statement-breakpoint
CREATE INDEX "tunnel_sessions_participant_idx" ON "tunnel_sessions" USING btree ("participant_id");
--> statement-breakpoint
CREATE INDEX "tunnel_messages_session_sent_idx" ON "tunnel_messages" USING btree ("tunnel_session_id","sent_at");
