// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Private messaging: the inbox (conversation list) and per-conversation
 * message threads, plus sending and marking messages read.
 *
 * Every route here is behind requireAuth. Conversations are keyed by username
 * in the URL so callers never have to resolve a user id themselves.
 *
 * Participant ordering: when we store or look up a conversation we always sort
 * the two user ids lexicographically so participantA < participantB. That one
 * invariant, enforced at write time, lets a unique index on (A, B) prevent
 * duplicate conversations without any read-before-write logic.
 */
import { Hono } from 'hono';
import {
  db,
  conversations,
  messages,
  deviceKeys,
  follows,
  users,
  eq,
  and,
  or,
  ne,
  lt,
  gte,
  isNull,
  sql,
  desc,
  inArray,
  count,
} from '@counter/db';
import { paginationQuerySchema, sendMessageSchema } from '@counter/types';
import type { Page, Conversation, DirectMessage, ConversationInfo, TunnelSessionWithTranscript } from '@counter/types';
import { fetchTunnelSessions } from './tunnel.ts';
import { body, query } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import { keysetWhere, paginate } from '../lib/cursor.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { serializeUsers } from '../services/serialize.ts';
import { findUserByUsername } from '../services/userquery.ts';
import { createNotification } from '../services/content.ts';
import { encryptMessage, decryptMessage, isE2eeMessage, isV3Message } from '../lib/crypto.ts';
import type { AppEnv } from '../types.ts';

export const messageRoutes = new Hono<AppEnv>();

messageRoutes.use('*', requireAuth);

// --- helpers ---

type ConvRow = typeof conversations.$inferSelect;

/**
 * Returns a SQL condition that is true for messages invisible to the given
 * participant. A message is invisible when the participant has deleted the
 * conversation (all messages gone from their view) or has cleared up to a
 * point in time (messages before that cutoff are hidden).
 *
 * Returns `sql`false`` when the participant hasn't acted — meaning all
 * messages are still visible to them and nothing is eligible for pruning.
 */
function invisibleTo(clearedAt: Date | null, deletedAt: Date | null) {
  if (deletedAt) return sql<boolean>`true`;
  if (clearedAt) return lt(messages.createdAt, clearedAt);
  return sql<boolean>`false`;
}

/**
 * Garbage-collect message data that neither participant can see anymore.
 *
 * If both have deleted the conversation, the whole row is dropped (messages
 * cascade). Otherwise, any message that is invisible to both parties is deleted
 * from the database — for example, when A cleared up to T1 and B cleared up to
 * T2, everything before min(T1, T2) can go.
 */
async function pruneConversation(conv: ConvRow) {
  if (conv.participantADeletedAt && conv.participantBDeletedAt) {
    await db.delete(conversations).where(eq(conversations.id, conv.id));
    return;
  }

  const aGone = invisibleTo(conv.participantAClearedAt, conv.participantADeletedAt);
  const bGone = invisibleTo(conv.participantBClearedAt, conv.participantBDeletedAt);

  await db
    .delete(messages)
    .where(and(eq(messages.conversationId, conv.id), aGone, bGone));
}

/**
 * Ensure exactly one conversation row exists for the given pair, creating it
 * if this is their first message. The two ids are sorted before the lookup so
 * the unique index on (participantA, participantB) is always hit correctly.
 *
 * @param onCreate - Status and requester to use when creating a new row. Only
 *   consulted when no row exists yet; ignored on existing conversations.
 */
async function findOrCreateConversation(
  userA: string,
  userB: string,
  onCreate?: { status: string; requestedBy: string | null },
) {
  // Sort is guaranteed to return two strings given two string inputs; the cast
  // tells TypeScript that both slots are definitely filled.
  const [partA, partB] = [userA, userB].sort() as [string, string];
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });
  if (existing) return existing;

  const rows = await db
    .insert(conversations)
    .values({
      participantA: partA,
      participantB: partB,
      status: onCreate?.status ?? 'active',
      requestedBy: onCreate?.requestedBy ?? null,
    })
    .returning();
  const created = rows[0];
  if (!created) throw errors.internal('Failed to create conversation');
  return created;
}

// --- inbox: list conversations ---

// Keyset-paginated by lastMessageAt so the inbox stays in activity order
// even as new messages arrive between page loads.
messageRoutes.get('/', async (c) => {
  const userId = requireUserId(c);
  const { after, limit } = query(c, paginationQuerySchema);

  // Resolve cursor: store lastMessageAt under the `createdAt` field that
  // keysetWhere expects; the column we pass in is what matters, not the name.
  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.conversations.findFirst({
      where: eq(conversations.id, after),
    });
    if (row) cursor = { createdAt: row.lastMessageAt, id: row.id };
  }

  // Exclude conversations the requesting user has deleted. A deleted conversation
  // stays in the DB so the other participant still sees it; we just hide it here.
  const base = or(
    and(eq(conversations.participantA, userId), isNull(conversations.participantADeletedAt)),
    and(eq(conversations.participantB, userId), isNull(conversations.participantBDeletedAt)),
  );
  const where = keysetWhere(conversations.lastMessageAt, conversations.id, cursor, base);

  const rows = await db
    .select()
    .from(conversations)
    .where(where)
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(limit + 1);

  const { data: pageConvs, nextCursor } = paginate(rows, limit, (r) => r.id);

  if (pageConvs.length === 0) {
    return c.json<Page<Conversation>>({ data: [], nextCursor: null });
  }

  const convIds = pageConvs.map((conv) => conv.id);

  // Fetch all messages for this page's conversations then group in memory.
  // An inbox page is at most 20 conversations so the total rows here are
  // manageable. The alternative (DISTINCT ON in raw SQL) would work but adds
  // complexity for no real gain at this scale.
  const allMessages = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, convIds))
    .orderBy(desc(messages.createdAt), desc(messages.id));

  // Keep only the newest real message per conversation. Screenshot events are
  // skipped here so the inbox preview shows the last thing someone said, not
  // "you took a screenshot".
  const lastMsgMap = new Map<string, typeof allMessages[0]>();
  for (const msg of allMessages) {
    if (!lastMsgMap.has(msg.conversationId) && msg.kind === 'message') {
      lastMsgMap.set(msg.conversationId, msg);
    }
  }

  // Unread = real messages from the partner that haven't been seen. Screenshot
  // events are excluded: they're informational and don't need a badge.
  const unreadRows = await db
    .select({ id: messages.conversationId, value: count() })
    .from(messages)
    .where(
      and(
        inArray(messages.conversationId, convIds),
        eq(messages.read, false),
        ne(messages.senderId, userId),
        eq(messages.kind, 'message'),
      ),
    )
    .groupBy(messages.conversationId);

  const unreadMap = new Map<string, number>();
  for (const row of unreadRows) unreadMap.set(row.id, Number(row.value));

  // Collect all user ids we need to serialize: partners and last-message senders.
  const partnerIds = pageConvs.map((conv) =>
    conv.participantA === userId ? conv.participantB : conv.participantA,
  );
  const senderIds = [...new Set([...partnerIds, ...Array.from(lastMsgMap.values()).map((m) => m.senderId)])];
  const userMap = await serializeUsers(senderIds, userId);

  const inboxKey = c.env.MESSAGE_ENCRYPTION_KEY;
  const data: Conversation[] = (
    await Promise.all(
      pageConvs.map(async (conv) => {
        const partnerId = conv.participantA === userId ? conv.participantB : conv.participantA;
        const partner = userMap.get(partnerId);
        // Skip conversations whose partner no longer exists (account deleted).
        if (!partner) return null;

        const isConvPartA = conv.participantA === userId;
        const userClearedAt = isConvPartA ? conv.participantAClearedAt : conv.participantBClearedAt;

        const lastMsgRow = lastMsgMap.get(conv.id) ?? null;
        let lastMessage: DirectMessage | null = null;
        // Hide the preview if the message predates the user's clear point.
        if (lastMsgRow && (!userClearedAt || lastMsgRow.createdAt >= userClearedAt)) {
          const sender = userMap.get(lastMsgRow.senderId);
          if (sender) {
            const e2ee = isE2eeMessage(lastMsgRow.body);
            lastMessage = {
              id: lastMsgRow.id,
              sender,
              // E2EE bodies are passed through as ciphertext; the client decrypts.
              body: e2ee ? lastMsgRow.body : await decryptMessage(lastMsgRow.body, inboxKey),
              read: lastMsgRow.read,
              encrypted: e2ee,
              kind: lastMsgRow.kind as DirectMessage['kind'],
              tunnelSessionId: lastMsgRow.tunnelSessionId ?? null,
              createdAt: lastMsgRow.createdAt.toISOString(),
            };
          }
        }

        return {
          id: conv.id,
          partner,
          lastMessage,
          unreadCount: unreadMap.get(conv.id) ?? 0,
          lastMessageAt: conv.lastMessageAt.toISOString(),
          createdAt: conv.createdAt.toISOString(),
          status: (conv.status ?? 'active') as 'active' | 'request',
          // Inbound when this user is the recipient, not the one who initiated.
          isInboundRequest: conv.status === 'request' && conv.requestedBy !== userId,
        } satisfies Conversation;
      }),
    )
  ).filter((conv): conv is Conversation => !!conv);

  return c.json<Page<Conversation>>({ data, nextCursor });
});

// --- conversation thread: list messages newest-first ---

// Returns messages newest-first so the client can reverse for display and
// still use the same `after` keyset cursor to page toward older messages.
messageRoutes.get('/:username', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');
  const { after, limit } = query(c, paginationQuerySchema);

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot message yourself');

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });

  // No conversation yet = empty thread, not a 404.
  if (!conv) {
    return c.json<Page<DirectMessage>>({ data: [], nextCursor: null });
  }

  const isPartA = conv.participantA === userId;

  // If the requesting user deleted this conversation, return empty rather than 404
  // so the client can still open the thread and start fresh.
  const userDeletedAt = isPartA ? conv.participantADeletedAt : conv.participantBDeletedAt;
  if (userDeletedAt) {
    return c.json<Page<DirectMessage>>({ data: [], nextCursor: null });
  }

  // Messages older than the user's clearedAt are hidden for them only.
  const userClearedAt = isPartA ? conv.participantAClearedAt : conv.participantBClearedAt;

  let cursor: { createdAt: Date; id: string } | null = null;
  if (after) {
    const row = await db.query.messages.findFirst({ where: eq(messages.id, after) });
    if (row) cursor = { createdAt: row.createdAt, id: row.id };
  }

  let base = eq(messages.conversationId, conv.id);
  if (userClearedAt) {
    // Show only messages sent at or after the clear point.
    base = and(base, gte(messages.createdAt, userClearedAt))!;
  }
  const where = keysetWhere(messages.createdAt, messages.id, cursor, base);

  const rows = await db
    .select()
    .from(messages)
    .where(where)
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit + 1);

  const { data: pageRows, nextCursor } = paginate(rows, limit, (r) => r.id);

  const senderIds = [...new Set(pageRows.map((r) => r.senderId))];
  const userMap = await serializeUsers(senderIds, userId);

  const key = c.env.MESSAGE_ENCRYPTION_KEY;
  const data: DirectMessage[] = (
    await Promise.all(
      pageRows.map(async (row) => {
        const sender = userMap.get(row.senderId);
        if (!sender) return null;
        const e2ee = isE2eeMessage(row.body);
        return {
          id: row.id,
          sender,
          body: e2ee ? row.body : await decryptMessage(row.body, key),
          read: row.read,
          encrypted: e2ee,
          kind: row.kind as DirectMessage['kind'],
          tunnelSessionId: row.tunnelSessionId ?? null,
          createdAt: row.createdAt.toISOString(),
        } satisfies DirectMessage;
      }),
    )
  ).filter((m): m is DirectMessage => !!m);

  // Collect tunnel session IDs from the page so the client can render inline
  // transcript blocks between tunnel_started/tunnel_ended markers without a
  // separate fetch. Two queries (sessions + messages) keyed by the IDs already
  // in memory — no N+1.
  const sessionIds = [
    ...new Set(data.map((m) => m.tunnelSessionId).filter(Boolean) as string[]),
  ];
  const tunnelSessions = await fetchTunnelSessions(sessionIds, userId);

  return c.json<Page<DirectMessage> & { tunnelSessions: Record<string, TunnelSessionWithTranscript> }>(
    { data, nextCursor, tunnelSessions },
  );
});

// --- live channel (WebSocket) ---

// Upgrades to this conversation's Durable Object hub so the client receives new
// messages, typing, and presence without polling. Auth and partner resolution
// happen here; the hub trusts the userId and canType we forward to it.
messageRoutes.get('/:username/live', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot message yourself');

  // Durable Objects only bind under wrangler dev. Without the binding there's
  // no hub to join; the client keeps using its existing fetch-on-load path.
  if (!c.env.CONVERSATION_HUB) throw errors.validation('Live updates are not available');

  // The hub gates typing on this flag, so a user who turned the setting off
  // can't have typing relayed even from a patched client.
  const me = await db.query.users.findFirst({ where: eq(users.id, userId) });
  const canType = me?.typingIndicatorsEnabled ? '1' : '0';

  // Both sides sort to the same key, so each participant joins the same hub.
  const pairKey = [userId, partner.id].sort().join(':');
  const stub = c.env.CONVERSATION_HUB.get(c.env.CONVERSATION_HUB.idFromName(pairKey));

  const url = new URL(c.req.url);
  url.searchParams.set('userId', userId);
  url.searchParams.set('canType', canType);
  return stub.fetch(new Request(url.toString(), c.req.raw));
});

// --- send a message ---

messageRoutes.post('/:username', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');
  const input = await body(c, sendMessageSchema);

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot message yourself');
  // Bot accounts never accept DMs. Hard block here, before any messaging-privacy
  // logic, so it can't be relaxed by a setting: you talk to a bot by mentioning
  // it in a post, not in private.
  if (partner.botKind) throw errors.forbidden('This account does not accept messages');

  // Check for an existing conversation so we can gate on its request status
  // before doing the heavier encryption work.
  const [sortedA, sortedB] = [userId, partner.id].sort() as [string, string];
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, sortedA), eq(conversations.participantB, sortedB)),
  });

  if (existing?.status === 'request') {
    if (existing.requestedBy === userId) {
      // Requester cannot send a second message until the recipient accepts.
      throw errors.validation('Message request pending — wait for a reply before sending more');
    }
    // Recipient must use the accept endpoint before replying; the UI enforces
    // this too, but we guard here so a direct API call is also rejected.
    throw errors.validation('Accept the message request before replying');
  }

  // For new conversations, apply the recipient's messaging privacy setting.
  let convStatus = 'active';
  let requestedBy: string | null = null;

  if (!existing) {
    if (partner.messagingPrivacy === 'nobody') {
      throw errors.forbidden('This user does not accept messages');
    }
    if (partner.messagingPrivacy === 'followers') {
      // 'followers' means only people who follow the recipient can DM directly.
      const isFollower = await db.query.follows.findFirst({
        where: and(eq(follows.followerId, userId), eq(follows.followingId, partner.id)),
      });
      if (!isFollower) {
        convStatus = 'request';
        requestedBy = userId;
      }
    }
  }

  const recipientKeys = await db
    .select()
    .from(deviceKeys)
    .where(eq(deviceKeys.userId, partner.id));

  // Two encryption paths depending on whether the recipient has registered
  // device keys. Plaintext is never written to the database in either case.
  let bodyToStore: string;
  if (recipientKeys.length > 0) {
    // E2EE path: client must send a v3 multi-device ciphertext. Reject v2 so
    // a stale client can't produce a message only one device can read.
    if (!isV3Message(input.body)) {
      throw errors.validation('Message must be end-to-end encrypted');
    }
    bodyToStore = input.body;
  } else {
    // Fallback path: recipient has no device keys. The client sends plaintext
    // and the server encrypts it with AES-256-GCM before storing. Both
    // parties see a notice in the UI explaining the downgrade.
    if (isE2eeMessage(input.body)) {
      // Shouldn't happen, but a stale client may try to send E2EE to someone
      // who has since deleted all device keys. Reject so the client refreshes.
      throw errors.validation('Recipient has not set up end-to-end encryption');
    }
    bodyToStore = await encryptMessage(input.body, c.env.MESSAGE_ENCRYPTION_KEY);
  }

  const conv = await findOrCreateConversation(
    userId,
    partner.id,
    existing ? undefined : { status: convStatus, requestedBy },
  );

  const inserted = await db
    .insert(messages)
    .values({ conversationId: conv.id, senderId: userId, body: bodyToStore })
    .returning();
  const msg = inserted[0];
  if (!msg) throw errors.internal('Failed to insert message');

  // Bump lastMessageAt so this conversation rises to the top of both inboxes.
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conv.id));

  // Tell the recipient they have a new message. createNotification handles the
  // self-skip and the recipient's mute setting, and carries the conversation id
  // so a tap on the notification opens this exact thread.
  await createNotification({
    userId: partner.id,
    type: 'message',
    actorId: userId,
    conversationId: conv.id,
  });

  // Build the response payload once and reuse it for the live hub broadcast.
  // The hub never decrypts; an E2EE body goes out as the same ciphertext the
  // recipient would have fetched, and only the server-encrypted fallback is
  // decrypted here to match what the REST list returns.
  const senderUser = (await serializeUsers([userId], userId)).get(userId);
  if (!senderUser) throw errors.internal('Failed to serialize sender');

  const e2ee = isE2eeMessage(bodyToStore);
  const responseMessage: DirectMessage = {
    id: msg.id,
    sender: senderUser,
    body: e2ee ? bodyToStore : await decryptMessage(bodyToStore, c.env.MESSAGE_ENCRYPTION_KEY),
    read: false,
    encrypted: e2ee,
    kind: msg.kind as DirectMessage['kind'],
    tunnelSessionId: msg.tunnelSessionId ?? null,
    createdAt: msg.createdAt.toISOString(),
  };

  // Push to the live socket best-effort: row is already stored so a hub failure
  // (or the Bun dev server where Durable Objects don't bind) never loses a message.
  if (c.env.CONVERSATION_HUB) {
    const pairKey = [userId, partner.id].sort().join(':');
    const stub = c.env.CONVERSATION_HUB.get(c.env.CONVERSATION_HUB.idFromName(pairKey));
    c.executionCtx.waitUntil(
      stub.fetch('https://hub/broadcast', {
        method: 'POST',
        body: JSON.stringify({ type: 'message', message: responseMessage }),
      }),
    );
  }

  return c.json<DirectMessage>(responseMessage, 201);
});

// --- conversation info (request status) ---

// Lightweight endpoint for the thread page to check request state without
// loading the full message list. Returns null status when no conversation exists.
messageRoutes.get('/:username/info', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot message yourself');

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });

  if (!conv) {
    return c.json<ConversationInfo>({ status: null, isInboundRequest: false });
  }

  return c.json<ConversationInfo>({
    status: (conv.status ?? 'active') as 'active' | 'request',
    isInboundRequest: conv.status === 'request' && conv.requestedBy !== userId,
  });
});

// --- accept a message request ---

// Sets the conversation status to 'active' so both sides can exchange messages
// freely. Only the recipient (the non-requester) is allowed to call this.
messageRoutes.post('/:username/accept', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });

  if (!conv) throw errors.notFound('Conversation not found');
  if (conv.status !== 'request') throw errors.validation('Conversation is not a message request');
  // Prevent the requester from accepting their own request.
  if (conv.requestedBy === userId) throw errors.forbidden('Cannot accept your own message request');

  await db
    .update(conversations)
    .set({ status: 'active', requestedBy: null })
    .where(eq(conversations.id, conv.id));

  return c.json({ ok: true });
});

// --- record a screenshot event ---

// Called by the client when the viewer screenshots the thread. Inserts a
// `kind: 'screenshot'` entry into the conversation so both parties see it in
// the transcript. Requires the conversation to already exist; you can't
// screenshot a thread you haven't opened yet.
messageRoutes.post('/:username/screenshot', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot message yourself');

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });
  if (!conv) throw errors.notFound('Conversation not found');

  const inserted = await db
    .insert(messages)
    // read: true so this never counts as an unread message for the partner
    .values({ conversationId: conv.id, senderId: userId, body: '', kind: 'screenshot', read: true })
    .returning();
  const msg = inserted[0];
  if (!msg) throw errors.internal('Failed to record screenshot');

  const userMap = await serializeUsers([userId], userId);
  const sender = userMap.get(userId);
  if (!sender) throw errors.internal('Failed to serialize user');

  return c.json<DirectMessage>({
    id: msg.id,
    sender,
    body: '',
    read: true,
    encrypted: false,
    kind: 'screenshot',
    tunnelSessionId: null,
    createdAt: msg.createdAt.toISOString(),
  }, 201);
});

// --- clear conversation (per-user) ---

// Sets a clearedAt timestamp for the requesting user only. Messages older than
// that point are filtered out of their thread view. The other participant is
// unaffected. A 'cleared' system message is inserted so the partner sees a
// notice in their transcript.
messageRoutes.delete('/:username/messages', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot message yourself');

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });

  if (!conv) return c.json({ ok: true });

  const isPartA = conv.participantA === userId;
  const now = new Date();

  await db
    .update(conversations)
    .set(isPartA ? { participantAClearedAt: now } : { participantBClearedAt: now })
    .where(eq(conversations.id, conv.id));

  // Insert after updating clearedAt so the message timestamp falls at or after
  // the cutoff and is visible to the clearing user in their fresh view.
  const inserted = await db
    .insert(messages)
    .values({ conversationId: conv.id, senderId: userId, body: '', kind: 'cleared', read: true })
    .returning();
  const msg = inserted[0];
  if (!msg) throw errors.internal('Failed to insert cleared event');

  // Re-fetch with the updated clearedAt so pruneConversation sees current state.
  const updatedConv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conv.id),
  });
  if (updatedConv) await pruneConversation(updatedConv);

  const userMap = await serializeUsers([userId], userId);
  const sender = userMap.get(userId);
  if (!sender) throw errors.internal('Failed to serialize user');

  return c.json<DirectMessage>({
    id: msg.id,
    sender,
    body: '',
    read: true,
    encrypted: false,
    kind: 'cleared',
    tunnelSessionId: null,
    createdAt: msg.createdAt.toISOString(),
  }, 200);
});

// --- delete conversation (per-user) ---

// Stamps the requesting user's deletedAt so the conversation disappears from
// their inbox. The other participant still sees all messages. A 'deleted' system
// message is inserted for the partner's transcript.
messageRoutes.delete('/:username', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');
  if (partner.id === userId) throw errors.validation('Cannot message yourself');

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });

  if (!conv) return c.json({ ok: true });

  const isPartA = conv.participantA === userId;

  await db
    .update(conversations)
    .set(isPartA ? { participantADeletedAt: new Date() } : { participantBDeletedAt: new Date() })
    .where(eq(conversations.id, conv.id));

  await db
    .insert(messages)
    .values({ conversationId: conv.id, senderId: userId, body: '', kind: 'deleted', read: true });

  // Re-fetch with the updated deletedAt so pruneConversation sees current state.
  const updatedConv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conv.id),
  });
  if (updatedConv) await pruneConversation(updatedConv);

  return c.json({ ok: true });
});

// --- mark conversation as read ---

// Marks all messages from the partner as read. Called when the viewer opens
// the thread, not on individual messages, to keep the API surface small.
messageRoutes.post('/:username/read', async (c) => {
  const userId = requireUserId(c);
  const username = c.req.param('username');

  const partner = await findUserByUsername(username);
  if (!partner) throw errors.notFound('User not found');

  const [partA, partB] = [userId, partner.id].sort() as [string, string];
  const conv = await db.query.conversations.findFirst({
    where: and(eq(conversations.participantA, partA), eq(conversations.participantB, partB)),
  });

  // No conversation means nothing to mark; respond 200 so the client doesn't
  // have to special-case a missing thread.
  if (!conv) return c.json({ ok: true });

  await db
    .update(messages)
    .set({ read: true })
    .where(
      and(
        eq(messages.conversationId, conv.id),
        eq(messages.senderId, partner.id),
        eq(messages.read, false),
      ),
    );

  return c.json({ ok: true });
});
