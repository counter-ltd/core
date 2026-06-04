import { Hono } from 'hono';
import { db, users, eq } from '@counter/db';
import { registerSchema, loginSchema, refreshSchema, logoutSchema } from '@counter/types';
import type { AuthResponse } from '@counter/types';
import { body } from '../lib/validate.ts';
import { errors } from '../lib/errors.ts';
import {
  hashPassword,
  verifyPassword,
  issueTokens,
  rotateTokens,
  revokeByRefreshToken,
} from '../lib/auth.ts';
import { requireAuth, requireUserId } from '../middleware/auth.ts';
import { getPrivateUser, findUserByIdentifier } from '../services/userquery.ts';
import type { AppEnv } from '../types.ts';

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/register', async (c) => {
  const input = await body(c, registerSchema);

  const existing = await db.query.users.findFirst({
    where: eq(users.username, input.username),
  });
  if (existing) throw errors.conflict('That username is taken');

  const emailTaken = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (emailTaken) throw errors.conflict('That email is already registered');

  const passwordHash = await hashPassword(input.password);
  const [created] = await db
    .insert(users)
    .values({
      username: input.username,
      email: input.email.toLowerCase(),
      passwordHash,
      displayName: input.displayName ?? null,
    })
    .returning();
  if (!created) throw errors.internal('Failed to create account');

  const tokens = await issueTokens(created.id);
  const user = await getPrivateUser(created.id);
  return c.json<AuthResponse>({ ...tokens, user }, 201);
});

authRoutes.post('/login', async (c) => {
  const input = await body(c, loginSchema);
  const row = await findUserByIdentifier(input.identifier);
  // Constant-ish failure: same error whether the user exists or not.
  if (!row || !(await verifyPassword(input.password, row.passwordHash))) {
    throw errors.unauthorized('Invalid credentials');
  }

  const tokens = await issueTokens(row.id);
  const user = await getPrivateUser(row.id);
  return c.json<AuthResponse>({ ...tokens, user });
});

authRoutes.post('/refresh', async (c) => {
  const input = await body(c, refreshSchema);
  const tokens = await rotateTokens(input.refreshToken);
  return c.json(tokens);
});

authRoutes.post('/logout', async (c) => {
  const input = await body(c, logoutSchema);
  if (input?.refreshToken) await revokeByRefreshToken(input.refreshToken);
  return c.json({ ok: true });
});

authRoutes.delete('/account', requireAuth, async (c) => {
  const userId = requireUserId(c);
  // Hard delete. Everything user-owned cascades; anonymous post_views remain.
  await db.delete(users).where(eq(users.id, userId));
  return c.json({ ok: true });
});
