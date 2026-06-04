import { sign, verify } from 'hono/jwt';
import { loadServerEnv } from '@counter/config/env';
import { parseDuration } from './duration.ts';
import { errors } from './errors.ts';

// Env is resolved lazily, not at module load. On Workers the config isn't
// available until the first request populates it (from the `env` bindings), so
// nothing here may touch loadServerEnv() at import time.
const cfg = () => loadServerEnv();

export const accessTtlSeconds = () => parseDuration(cfg().JWT_EXPIRES_IN);
export const refreshTtlSeconds = () => parseDuration(cfg().JWT_REFRESH_EXPIRES_IN);

interface AccessPayload {
  sub: string;
  type: 'access';
  exp: number;
  [key: string]: unknown;
}

interface RefreshPayload {
  sub: string;
  sid: string;
  /** Unique per token so rotation always yields a distinct, distinguishable token. */
  jti: string;
  type: 'refresh';
  exp: number;
  [key: string]: unknown;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function signAccessToken(userId: string): Promise<string> {
  const payload: AccessPayload = {
    sub: userId,
    type: 'access',
    exp: nowSeconds() + accessTtlSeconds(),
  };
  return sign(payload, cfg().JWT_SECRET, 'HS256');
}

export async function signRefreshToken(userId: string, sessionId: string): Promise<string> {
  const payload: RefreshPayload = {
    sub: userId,
    sid: sessionId,
    jti: crypto.randomUUID(),
    type: 'refresh',
    exp: nowSeconds() + refreshTtlSeconds(),
  };
  return sign(payload, cfg().JWT_REFRESH_SECRET, 'HS256');
}

export async function verifyAccessToken(token: string): Promise<{ userId: string }> {
  try {
    const payload = (await verify(token, cfg().JWT_SECRET, 'HS256')) as unknown as AccessPayload;
    if (payload.type !== 'access') throw new Error('wrong token type');
    return { userId: payload.sub };
  } catch {
    throw errors.unauthorized('Invalid or expired access token');
  }
}

export async function verifyRefreshToken(
  token: string,
): Promise<{ userId: string; sessionId: string }> {
  try {
    const payload = (await verify(
      token,
      cfg().JWT_REFRESH_SECRET,
      'HS256',
    )) as unknown as RefreshPayload;
    if (payload.type !== 'refresh') throw new Error('wrong token type');
    return { userId: payload.sub, sessionId: payload.sid };
  } catch {
    throw errors.unauthorized('Invalid or expired refresh token');
  }
}
