import { db, users, eq, or } from '@counter/db';
import { serializeUsers } from './serialize.ts';
import { errors } from '../lib/errors.ts';
import type { PrivateUser, PublicUser } from '@counter/types';

export async function findUserByIdentifier(identifier: string) {
  const lowered = identifier.toLowerCase();
  return db.query.users.findFirst({
    where: or(eq(users.username, lowered), eq(users.email, lowered)),
  });
}

export async function findUserByUsername(username: string) {
  return db.query.users.findFirst({ where: eq(users.username, username.toLowerCase()) });
}

/** Public projection for a username, or 404. */
export async function getPublicUser(username: string, viewerId?: string): Promise<PublicUser> {
  const row = await findUserByUsername(username);
  if (!row) throw errors.notFound('User not found');
  const map = await serializeUsers([row.id], viewerId);
  const user = map.get(row.id);
  if (!user) throw errors.notFound('User not found');
  return user;
}

/** Own profile with private fields (email). */
export async function getPrivateUser(userId: string): Promise<PrivateUser> {
  const row = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!row) throw errors.notFound('User not found');
  const map = await serializeUsers([row.id], userId);
  const pub = map.get(row.id);
  if (!pub) throw errors.notFound('User not found');
  return { ...pub, email: row.email };
}
