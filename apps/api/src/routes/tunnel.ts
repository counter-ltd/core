// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Tunnel Talk: peer-to-peer ephemeral chat between two online users.
 *
 * These routes handle the invite/accept lifecycle and the WebSocket upgrade to
 * the signaling Durable Object. The DO relays SDP and ICE candidates between
 * the two peers; after that, all message traffic is direct P2P and never
 * reaches this server.
 *
 * Transcript saving is also managed here: clients upload an encrypted batch
 * after the session ends. Revocation deletes all stored messages atomically.
 */

import { Hono } from 'hono';
import {
  db,
  conversations,
  messages,
  tunnelSessions,
  tunnelMessages,
  deviceKeys,
  users,
  eq,
  and,
  or,
  gte,
  sql,
  desc,
  inArray,
} from '@counter/db';
import { isV3Message } from '../lib/crypto.ts';
import { PRESENCE, TUNNEL } from '@counter/config';
import { uploadTranscriptSchema } from '@counter/types';
import type {
  TunnelSession,
  TunnelSessionWithTranscript,
  TurnCredentials,
} from '@counter/types';
import { body } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { serializeUsers } from '../services/serialize.ts';
import { findUserByUsername } from '../services/userquery.ts';
import { createNotification } from '../services/content.ts';
import type { AppEnv } from '../types.ts';

export const tunnelRoutes = new Hono<AppEnv>();

tunnelRoutes.use('*', requireAuth);

// --- helpers ---

/**
 * Serialize a tunnel session DB row into the API response shape, embedding
 * `PublicUser` objects for both participants.
 *
 * @param row - Raw tunnel_sessions row from the database.
 * @param transcriptRows - Optional tunnel_messages to embed (empty by default).
 * @param viewerId - The requesting user, for serializing presence visibility.
 */
async function serializeSession(
  row: typeof tunnelSessions.$inferSelect,
  viewerId: string,
  transcriptRows: (typeof tunnelMessages.$inferSelect)[] = [],
): Promise<TunnelSessionWithTranscript | null> {
  const userIds = [row.initiatorId, row.participantId].filter(Boolean) as string[];
  const userMap = await serializeUsers(userIds, viewerId);

  const initiator = row.initiatorId ? userMap.get(row.initiatorId) : undefined;
  const participant = row.participantId ? userMap.get(row.participantId) : undefined;
  if (!initiator || !participant) return null;

  // Collect sender IDs from transcript rows that need serializing.
  const senderIds = [...new Set(transcriptRows.map((m) => m.senderId).filter(Boolean))] as string[];
  const senderMap =
    senderIds.length > 0 ? await serializeUsers(senderIds, viewerId) : new Map();

  return {
    id: row.id,
    conversationId: row.conversationId,
    initiator,
    participant,
    status: row.status as TunnelSession['status'],
    initiatorConsent: row.initiatorConsent,
    participantConsent: row.participantConsent,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    messages: transcriptRows.flatMap((m) => {
      const sender = m.senderId ? senderMap.get(m.senderId) : undefined;
      if (!sender) return [];
      return [{ id: m.id, sender, body: m.body, sentAt: m.sentAt.toISOString() }];
    }),
  };
}

/**
 * Load a tunnel session and verify the caller is a participant.
 *
 * @throws 404 if the session doesn't exist.
 * @throws 403 if the caller is not the initiator or participant.
 */
async function loadSession(sessionId: string, userId: string) {
  const row = await db.query.tunnelSessions.findFirst({
    where: eq(tunnelSessions.id, sessionId),
  });
  if (!row) throw errors.notFound('Session not found');
  if (row.initiatorId !== userId && row.participantId !== userId) {
    throw errors.forbidden();
  }
  return row;
}

/**
 * Returns true when a user's heartbeat is recent enough to consider them online.
 *
 * Uses the same formula as serializeUsers so the invite button and the server
 * check agree on what "online" means.
 */
async function isUserOnline(userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { onlineStatusEnabled: true, lastSeenAt: true, heartbeatIntervalSeconds: true },
  });
  if (!user || !user.onlineStatusEnabled || !user.lastSeenAt) return false;
  const thresholdMs = (user.heartbeatIntervalSeconds + PRESENCE.ONLINE_GRACE_SECONDS) * 1000;
  return Date.now() - user.lastSeenAt.getTime() < thresholdMs;
}

// --- TURN credentials ---

// Registered before the dynamic /:username routes to prevent "turn-credentials"
// being interpreted as a username.
tunnelRoutes.get('/turn-credentials', async (c) => {
  requireUserId(c);

  const keyId = c.env.TURN_KEY_ID;
  const keySecret = c.env.TURN_KEY_SECRET;

  // When TURN keys aren't configured, fall back to public STUN only. This works
  // for clients behind simple NATs but will fail for symmetric NAT / enterprise
  // firewalls. Set TURN_KEY_ID + TURN_KEY_SECRET in production to cover those.
  if (!keyId || !keySecret) {
    return c.json<TurnCredentials>({
      urls: ['stun:stun.cloudflare.com:3478'],
      username: '',
      credential: '',
    });
  }

  const resp = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${keySecret}`, 'Content-Type': 'application/json' },
      // TTL is deliberately short: clients fetch fresh creds per session attempt.
      body: JSON.stringify({ ttl: 300 }),
    },
  );
  if (!resp.ok) throw errors.internal('Failed to generate TURN credentials');

  const data = (await resp.json()) as {
    iceServers: { urls: string[] | string; username: string; credential: string };
  };
  const server = data.iceServers;
  if (!server) throw errors.internal('Empty ICE server list from TURN API');

  return c.json<TurnCredentials>({
    urls: Array.isArray(server.urls) ? server.urls : [server.urls],
    username: server.username,
    credential: server.credential,
  });
});

// --- invite flow ---

tunnelRoutes.post('/:username/invite', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot tunnel with yourself');

  if (!(await isUserOnline(partner.id))) {
    throw errors.conflict('That user is not currently online');
  }

  // Require an existing active conversation — Tunnel Talk is an escalation of
  // a real conversation, not a cold-contact mechanism.
  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(
      eq(conversations.participantA, partA),
      eq(conversations.participantB, partB),
      eq(conversations.status, 'active'),
    ),
  });
  if (!conv) throw errors.validation('No active conversation with this user');

  // Tunnel Talk is the high-assurance, end-to-end-encrypted path, so it's only
  // offered when E2EE is actually working for both sides: each must have at least
  // one registered device key. Without that, transcripts would fall back to
  // server-readable storage, which defeats the entire point of the feature. Users
  // without keys stay on regular DMs (server-side encryption, with the in-app
  // downgrade notice).
  const keyHolders = await db
    .selectDistinct({ userId: deviceKeys.userId })
    .from(deviceKeys)
    .where(inArray(deviceKeys.userId, [userId, partner.id]));
  if (keyHolders.length < 2) {
    throw errors.validation(
      'Tunnel Talk needs end-to-end encryption enabled on both accounts. Ask the other person to set up a device key.',
    );
  }

  // One invite at a time — block if a pending session already exists.
  const existing = await db.query.tunnelSessions.findFirst({
    where: and(
      eq(tunnelSessions.conversationId, conv.id),
      eq(tunnelSessions.status, 'pending'),
    ),
  });
  if (existing) throw errors.conflict('A pending Tunnel Talk invite already exists');

  // Prevent stacking active sessions — one at a time per user.
  const activeSession = await db.query.tunnelSessions.findFirst({
    where: and(
      or(
        eq(tunnelSessions.initiatorId, userId),
        eq(tunnelSessions.participantId, userId),
      ),
      eq(tunnelSessions.status, 'active'),
    ),
  });
  if (activeSession) throw errors.conflict('You already have an active Tunnel Talk session');

  const [session] = await db
    .insert(tunnelSessions)
    .values({ conversationId: conv.id, initiatorId: userId, participantId: partner.id })
    .returning();
  if (!session) throw errors.internal('Failed to create tunnel session');

  // Insert the thread marker so the conversation history shows a Tunnel Talk
  // entry even if no transcript is ever saved.
  await db.insert(messages).values({
    conversationId: conv.id,
    senderId: userId,
    body: '',
    kind: 'tunnel_started',
    tunnelSessionId: session.id,
    read: true,
  });

  await createNotification({
    userId: partner.id,
    type: 'tunnel_invite',
    actorId: userId,
    conversationId: conv.id,
  });

  // Push the invite to the recipient's open thread so the join banner appears
  // live. Sent to the partner only (except the initiator, who opened Tunnel Talk
  // optimistically). Best-effort: the /pending fetch on thread load is the
  // fallback when the hub isn't bound or the recipient doesn't have it open.
  if (c.env.CONVERSATION_HUB) {
    const serialized = await serializeSession(session, partner.id);
    if (serialized) {
      const pairKey = [userId, partner.id].sort().join(':');
      const stub = c.env.CONVERSATION_HUB.get(c.env.CONVERSATION_HUB.idFromName(pairKey));
      c.executionCtx.waitUntil(
        stub.fetch(`https://hub/broadcast?except=${userId}`, {
          method: 'POST',
          body: JSON.stringify({ type: 'tunnel_invite', session: serialized }),
        }),
      );
    }
  }

  return c.json({ sessionId: session.id }, 201);
});

// Check whether this user has an incoming pending Tunnel Talk invite from the
// given username. Fetched once when the conversation view opens, to catch an
// invite that already existed; live invites that arrive afterward come over the
// conversation socket instead (see the invite route's broadcast), so this is no
// longer polled.
tunnelRoutes.get('/:username/pending', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) return c.json({ pending: false });

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });
  if (!conv) return c.json({ pending: false });

  const session = await db.query.tunnelSessions.findFirst({
    where: and(
      eq(tunnelSessions.conversationId, conv.id),
      eq(tunnelSessions.status, 'pending'),
      // Only show invites sent by the partner to this user (inbound).
      eq(tunnelSessions.initiatorId, partner.id),
      eq(tunnelSessions.participantId, userId),
    ),
    orderBy: [desc(tunnelSessions.createdAt)],
  });

  if (!session) return c.json({ pending: false });

  // Expire stale invites rather than leaving them to pile up.
  const ageSeconds = (Date.now() - session.createdAt.getTime()) / 1000;
  if (ageSeconds > TUNNEL.INVITE_EXPIRES_SECONDS) {
    await db
      .update(tunnelSessions)
      .set({ status: 'declined' })
      .where(eq(tunnelSessions.id, session.id));
    await db.insert(messages).values({
      conversationId: conv.id,
      senderId: session.initiatorId!,
      body: '',
      kind: 'tunnel_ended',
      tunnelSessionId: session.id,
      read: true,
    });
    return c.json({ pending: false });
  }

  const serialized = await serializeSession(session, userId);
  if (!serialized) return c.json({ pending: false });

  return c.json({ pending: true, session: serialized });
});

// --- session lifecycle ---

tunnelRoutes.post('/:sessionId/accept', async (c) => {
  const userId = requireUserId(c);
  const sessionId = c.req.param('sessionId');
  const session = await loadSession(sessionId, userId);

  if (session.participantId !== userId) {
    throw errors.forbidden('Only the invited user can accept');
  }
  if (session.status !== 'pending') {
    throw errors.validation('Session is no longer pending');
  }
  const ageSeconds = (Date.now() - session.createdAt.getTime()) / 1000;
  if (ageSeconds > TUNNEL.INVITE_EXPIRES_SECONDS) {
    throw errors.validation('Invite has expired');
  }

  await db
    .update(tunnelSessions)
    .set({ status: 'active', startedAt: new Date() })
    .where(eq(tunnelSessions.id, sessionId));

  return c.json({ ok: true });
});

tunnelRoutes.post('/:sessionId/decline', async (c) => {
  const userId = requireUserId(c);
  const sessionId = c.req.param('sessionId');
  const session = await loadSession(sessionId, userId);

  if (session.participantId !== userId) {
    throw errors.forbidden('Only the invited user can decline');
  }

  await db
    .update(tunnelSessions)
    .set({ status: 'declined' })
    .where(eq(tunnelSessions.id, sessionId));

  await db.insert(messages).values({
    conversationId: session.conversationId,
    senderId: userId,
    body: '',
    kind: 'tunnel_ended',
    tunnelSessionId: sessionId,
    read: true,
  });

  return c.json({ ok: true });
});

tunnelRoutes.delete('/:sessionId', async (c) => {
  const userId = requireUserId(c);
  const sessionId = c.req.param('sessionId');
  const session = await loadSession(sessionId, userId);

  // Idempotent — ending an already-ended session is not an error.
  if (session.status === 'ended' || session.status === 'declined') {
    return c.json({ ok: true });
  }

  const now = new Date();
  await db
    .update(tunnelSessions)
    .set({ status: 'ended', endedAt: now })
    .where(eq(tunnelSessions.id, sessionId));

  // Only insert the end marker if one doesn't exist yet (decline path already
  // inserts one, but delete can race with it when both peers end simultaneously).
  const existingEnd = await db.query.messages.findFirst({
    where: and(
      eq(messages.tunnelSessionId, sessionId),
      eq(messages.kind, 'tunnel_ended'),
    ),
  });
  if (!existingEnd) {
    await db.insert(messages).values({
      conversationId: session.conversationId,
      senderId: userId,
      body: '',
      kind: 'tunnel_ended',
      tunnelSessionId: sessionId,
      read: true,
    });
  }

  return c.json({ ok: true });
});

// --- consent ---

tunnelRoutes.put('/:sessionId/consent', async (c) => {
  const userId = requireUserId(c);
  const sessionId = c.req.param('sessionId');
  const session = await loadSession(sessionId, userId);

  if (session.status !== 'active') {
    throw errors.validation('Session is not active');
  }

  const isInitiator = session.initiatorId === userId;
  await db
    .update(tunnelSessions)
    .set(isInitiator ? { initiatorConsent: true } : { participantConsent: true })
    .where(eq(tunnelSessions.id, sessionId));

  return c.json({ ok: true });
});

tunnelRoutes.delete('/:sessionId/consent', async (c) => {
  const userId = requireUserId(c);
  const sessionId = c.req.param('sessionId');
  const session = await loadSession(sessionId, userId);

  if (session.status !== 'active') {
    throw errors.validation('Session is not active');
  }

  // Revocation must be atomic: clear the consent flag and delete all saved
  // transcript rows in a single transaction. A partial state (consent cleared
  // but messages remain, or vice versa) would be a privacy bug.
  const isInitiator = session.initiatorId === userId;
  await db.transaction(async (tx) => {
    await tx
      .update(tunnelSessions)
      .set(isInitiator ? { initiatorConsent: false } : { participantConsent: false })
      .where(eq(tunnelSessions.id, sessionId));
    await tx.delete(tunnelMessages).where(eq(tunnelMessages.tunnelSessionId, sessionId));
  });

  return c.json({ ok: true });
});

// --- transcript upload ---

// Called by the client after the session ends, only when the user consented.
// Bodies are E2EE ciphertext identical in format to regular DMs — the server
// stores opaque bytes and never decrypts.
tunnelRoutes.post('/:sessionId/transcript', async (c) => {
  const userId = requireUserId(c);
  const sessionId = c.req.param('sessionId');
  const session = await loadSession(sessionId, userId);

  if (session.status !== 'ended') {
    throw errors.validation('Session must be ended before uploading transcript');
  }

  const isInitiator = session.initiatorId === userId;
  const hasConsent = isInitiator ? session.initiatorConsent : session.participantConsent;
  if (!hasConsent) {
    throw errors.forbidden('You did not consent to saving this transcript');
  }

  const { messages: entries } = await body(c, uploadTranscriptSchema);
  if (entries.length === 0) return c.json({ ok: true });

  // Every transcript body must be a v3 E2EE ciphertext. The schema only checks
  // it's a non-empty string, so without this a buggy or hostile client could
  // upload plaintext into the most privacy-sensitive table we have. Reject the
  // whole batch if any entry isn't end-to-end encrypted.
  if (!entries.every((e) => isV3Message(e.body))) {
    throw errors.validation('Tunnel transcripts must be end-to-end encrypted');
  }

  await db.insert(tunnelMessages).values(
    entries.map((e) => ({
      tunnelSessionId: sessionId,
      senderId: userId,
      body: e.body,
      sentAt: new Date(e.sentAt),
    })),
  );

  return c.json({ ok: true });
});

// --- WebSocket signaling upgrade ---

// Validates auth and session membership, then forwards the WebSocket upgrade
// to the signaling Durable Object. The DO relays SDP/ICE between the two peers
// and hibernates once they stop signaling — it never sees message content.
tunnelRoutes.get('/:sessionId/signal', async (c) => {
  const userId = requireUserId(c);
  const sessionId = c.req.param('sessionId');
  const session = await loadSession(sessionId, userId);

  // Allow both 'pending' and 'active'. The initiator connects while the session
  // is still pending so they're already on the signaling channel when the
  // participant accepts and joins (peer_joined fires for both). Reject only
  // terminal states where there's nothing left to negotiate.
  if (session.status === 'ended' || session.status === 'declined') {
    throw errors.validation('Session is no longer open');
  }

  const id = c.env.TUNNEL_SIGNALING.idFromName(sessionId);
  const stub = c.env.TUNNEL_SIGNALING.get(id);

  // Attach userId as a query param so the DO can identify which peer is which
  // without needing to re-validate the JWT (that already happened above).
  const url = new URL(c.req.url);
  url.searchParams.set('userId', userId);

  return stub.fetch(new Request(url.toString(), c.req.raw));
});

// --- bulk session lookup (used by GET /messages/:username) ---

/**
 * Fetch multiple tunnel sessions with their transcripts, keyed by session ID.
 *
 * Used by the message thread route to embed session data alongside messages so
 * the client can render inline transcript blocks without a separate fetch.
 *
 * @param sessionIds - Session IDs to fetch (deduped from the message page).
 * @param viewerId - Requesting user, for presence visibility in serialization.
 */
export async function fetchTunnelSessions(
  sessionIds: string[],
  viewerId: string,
): Promise<Record<string, TunnelSessionWithTranscript>> {
  if (sessionIds.length === 0) return {};

  const rows = await db.query.tunnelSessions.findMany({
    where: inArray(tunnelSessions.id, sessionIds),
  });
  const msgRows = await db.query.tunnelMessages.findMany({
    where: inArray(tunnelMessages.tunnelSessionId, sessionIds),
    orderBy: [sql`sent_at ASC`],
  });

  // Group transcript rows by session so we can attach them in one pass.
  const msgsBySession = new Map<string, (typeof tunnelMessages.$inferSelect)[]>();
  for (const m of msgRows) {
    const bucket = msgsBySession.get(m.tunnelSessionId) ?? [];
    bucket.push(m);
    msgsBySession.set(m.tunnelSessionId, bucket);
  }

  const result: Record<string, TunnelSessionWithTranscript> = {};
  await Promise.all(
    rows.map(async (row) => {
      const transcript = msgsBySession.get(row.id) ?? [];
      const serialized = await serializeSession(row, viewerId, transcript);
      if (serialized) result[row.id] = serialized;
    }),
  );
  return result;
}
