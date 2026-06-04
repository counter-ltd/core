import type { Context } from 'hono';
import type { z } from 'zod';
import { errors } from './errors.ts';

/** Parse and validate a JSON body. ZodErrors bubble to the central handler. */
export async function body<T extends z.ZodTypeAny>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw errors.validation('Request body must be valid JSON');
  }
  return schema.parse(raw);
}

/** Parse and validate the query string. */
export function query<T extends z.ZodTypeAny>(c: Context, schema: T): z.infer<T> {
  return schema.parse(c.req.query());
}
