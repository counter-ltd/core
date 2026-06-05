// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Isolate-level access to the Worker bindings for code that runs outside a
 * request handler.
 *
 * Most code reaches platform bindings through `c.env` in a route. Services don't
 * have a context, and `loadServerEnv` only carries the parsed secret strings,
 * not the Durable Object namespaces. createNotification (a service called from
 * seven routes) needs the NotificationHub namespace to push live notifications,
 * so the Worker entry stashes the whole bindings object here once per request.
 *
 * Holding it at module scope is safe for the same reason loadServerEnv caches:
 * the bindings are identical for every request to a given Worker isolate, so
 * re-setting them each request is a cheap overwrite, not a leak across tenants.
 * Absent under the Bun dev server (no DO bindings there), so every read guards.
 */
import type { WorkerBindings } from '../types.ts';

let current: WorkerBindings | null = null;

/** Called once per request from the Worker entry, with the platform bindings. */
export function setWorkerBindings(env: WorkerBindings): void {
  current = env;
}

/** The current Worker bindings, or null when running outside Workers (Bun dev). */
export function getWorkerBindings(): WorkerBindings | null {
  return current;
}
