// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The gate for admin routes: turn a required permission into a 401/403 check.
 *
 * `requirePermission(perm)` resolves the caller's effective permissions (the
 * union across their groups) the first time it runs and stashes them on the
 * context, so chaining several checks on one request only hits the database
 * once. It assumes `optionalAuth` ran earlier to set `userId`; an anonymous
 * caller gets a 401, a signed-in caller without the permission gets a 403.
 */
import { createMiddleware } from 'hono/factory';
import { errors } from '../lib/errors.ts';
import { getUserPermissions } from '../services/permissions.ts';
import type { Permission } from '@counter/config';
import type { AppEnv } from '../types.ts';

/**
 * Build a middleware that requires `perm` on the caller.
 *
 * @param perm  The capability the route needs. Throws 401 when no user is
 *              attached, 403 when the user is real but lacks the permission.
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
