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
import { serializeUsers } from './serialize.ts';
import { getTrustBadges } from './trust.ts';
import { errors } from '../lib/errors.ts';
import type { PrivateUser, PublicUser } from '@counter/types';

/**
 * Find a user by either username or email, whichever the input matches. Used at
 * login, where the same field accepts both.
 *
 * Lowercased before matching because both columns are stored lowercased, so a
 * raw-case "Alice@x.com" still resolves.
 */
export async function findUserByIdentifier(identifier: string) {
  const lowered = identifier.toLowerCase();
  return db.query.users.findFirst({
    where: or(eq(users.username, lowered), eq(users.email, lowered)),
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
  return { ...pub, email: row.email };
}
