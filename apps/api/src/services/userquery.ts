// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Looking users up and handing them back in the right projection.
 *
 * The find* helpers return raw user rows for internal use (login, ownership
 * checks). The get* functions return the serialized API shapes and throw a 404
 * when there's no match, so route handlers don't each have to repeat that guard.
 */
import { db, users, eq, or } from '@counter/db';
import { loadServerEnv } from '@counter/config/env';
import { serializeUsers } from './serialize.ts';
import { getTrustBadges } from './trust.ts';
import { getUserGroupRows, effectivePermissions, toGroupSummaries } from './permissions.ts';
import { errors } from '../lib/errors.ts';
import { blindIndex, decryptField } from '../lib/crypto.ts';
import type { PrivateUser, PublicUser } from '@counter/types';
import type { PresenceVisibility, MessagingPrivacy, UserStatus } from '@counter/config';

/**
 * Find a user by either username or email, whichever the input matches. Used at
 * login, where the same field accepts both.
 *
 * Lowercased before matching because usernames are stored lowercased and the
 * email blind index is computed over the lower-cased address, so a raw-case
 * "Alice@x.com" still resolves. Email is encrypted at rest, so we match on its
 * blind index rather than the (un-queryable) ciphertext column.
 */
export async function findUserByIdentifier(identifier: string) {
  const lowered = identifier.toLowerCase();
  const emailIdx = await blindIndex(lowered, loadServerEnv().BLIND_INDEX_KEY);
  return db.query.users.findFirst({
    where: or(eq(users.username, lowered), eq(users.emailIndex, emailIdx)),
  });
}

/** Find a user by username (case-insensitive). Returns the raw row, or undefined. */
export async function findUserByUsername(username: string) {
  return db.query.users.findFirst({ where: eq(users.username, username.toLowerCase()) });
}

/**
 * Public profile for a username, or a 404 if no such user.
 *
 * @param viewerId  Passed through to the serializer so the result carries the
 *                  viewer's follow relationship when someone is signed in.
 */
export async function getPublicUser(username: string, viewerId?: string): Promise<PublicUser> {
  const row = await findUserByUsername(username);
  if (!row) throw errors.notFound('User not found');
  const map = await serializeUsers([row.id], viewerId);
  const user = map.get(row.id);
  if (!user) throw errors.notFound('User not found');
  // Badges are attached here, on the single-profile read, not in serializeUsers,
  // so feeds full of post authors don't each pay for a badge query.
  user.signals = await getTrustBadges(row.id, row.verified);
  return user;
}

/**
 * The signed-in user's own profile: the public projection plus private fields
 * (currently the email) that we never expose about anyone else.
 *
 * Serialized with userId as its own viewer, so isSelf comes back true. The email
 * is spread on last, after serialization, since serializeUsers only ever builds
 * the public shape.
 */
export async function getPrivateUser(userId: string): Promise<PrivateUser> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw errors.notFound('User not found');
  const map = await serializeUsers([row.id], userId);
  const pub = map.get(row.id);
  if (!pub) throw errors.notFound('User not found');
  pub.signals = await getTrustBadges(row.id, row.verified);
  // Stored encrypted; decrypt for the owner's own profile view. decryptField
  // passes through any legacy plain-text value unchanged, so this is safe pre- or
  // post-encryption.
  const email = await decryptField(row.email, loadServerEnv().MESSAGE_ENCRYPTION_KEY);
  // Resolve the owner's own groups and the permissions they add up to, so a
  // client can decide whether to surface the admin panel without a second call.
  const groupRows = await getUserGroupRows(row.id);
  return {
    ...pub,
    email,
    // null hash means an OAuth-only account that has never set a password. The
    // row is already loaded, so this costs nothing extra.
    hasPassword: row.passwordHash !== null,
    groups: toGroupSummaries(groupRows),
    permissions: effectivePermissions(groupRows),
    status: row.status as UserStatus,
    presenceSettings: {
      onlineStatusEnabled: row.onlineStatusEnabled,
      onlineStatusVisibility: row.onlineStatusVisibility as PresenceVisibility,
      lastSeenEnabled: row.lastSeenEnabled,
      lastSeenVisibility: row.lastSeenVisibility as PresenceVisibility,
      heartbeatIntervalSeconds: row.heartbeatIntervalSeconds,
      messagingPrivacy: row.messagingPrivacy as MessagingPrivacy,
      typingIndicatorsEnabled: row.typingIndicatorsEnabled,
    },
  };
}
