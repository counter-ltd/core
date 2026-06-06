// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Middleware factory for admin route access control.
 *
 * Wraps permission checks behind a Hono middleware so routes can declare what
 * they need without duplicating auth logic. Relies on `optionalAuth` running
 * earlier in the chain to populate `userId` on the context.
 */
import { createMiddleware } from 'hono/factory';
import { errors } from '../lib/errors.ts';
import { getUserPermissions } from '../services/permissions.ts';
import type { Permission } from '@counter/config';
import type { AppEnv } from '../types.ts';

/**
 * Build a middleware that requires `perm` on the calling user.
 *
 * Resolves the caller's effective permissions (the union across all their
 * groups) and caches them on the context, so a route guarded by two
 * permissions only hits the database once. Anonymous callers get a 401;
 * authenticated callers without the permission get a 403.
 *
 * @param perm  The capability the route needs.
 */
export function requirePermission(perm: Permission) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get('userId');
    if (!userId) throw errors.unauthorized();

    // Memoise on the context so a route guarded by two permissions resolves the
    // union once rather than per check.
    let perms = c.get('permissions');
    if (!perms) {
      perms = await getUserPermissions(userId);
      c.set('permissions', perms);
    }

    if (!perms.includes(perm)) throw errors.forbidden();
    await next();
  });
}
