// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Thin bridge from a raw Hono request to a validated, typed value.
 *
 * Routes hand in a Zod schema and get back data already narrowed to its type,
 * so handler bodies never touch unparsed input. Validation failures are thrown,
 * not returned, so the happy path stays linear and the central error handler
 * turns them into 422s.
 */
import type { Context } from 'hono';
import type { z } from 'zod';
import { errors } from './errors.ts';

/**
 * Read and validate the JSON request body against a schema.
 *
 * A body that doesn't parse as JSON at all gets its own clear message rather
 * than a cryptic ZodError, so the separation here is intentional. Schema
 * violations fall through to the central error handler as ZodErrors.
 */
export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw errors.validation('Request body must be valid JSON');
  }
  return schema.parse(raw);
}

/**
 * Validate the query string against a schema.
 *
 * No JSON-parse step to guard here: query params are always strings, so the
 * schema does all the work (coercing, defaulting, rejecting). Lean on Zod's
 * `coerce`/`default` for things like numeric limits and cursors.
 */
export function query<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return schema.parse(c.req.query());
}
