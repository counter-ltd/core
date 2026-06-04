// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Topics: the named spaces users can join and post into. Holds the slug rules,
 * the create schema, and both the trimmed reference and full read shapes.
 */
import { z } from 'zod';

// Slug must start with a letter and stay url-safe, since it's what appears in
// `/t/<slug>`. The leading-letter rule keeps slugs from looking like ids.
export const topicSlugSchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z][a-z0-9_-]*$/, 'Slug must start with a letter and contain only lowercase letters, digits, underscores, or hyphens');

/** Body for creating a topic. */
export const createTopicSchema = z.object({
  slug: topicSlugSchema,
  name: z.string().min(1).max(100), // human-facing display name
  description: z.string().max(500).optional(),
});
export type CreateTopicInput = z.infer<typeof createTopicSchema>;

/** Just enough topic to render a label/link, embedded inside posts. */
export interface TopicRef {
  id: string;
  slug: string;
  name: string;
}

/** A topic with its full detail and counts, as the API returns it. */
export interface Topic {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  createdAt: string;
  counts: {
    members: number;
    posts: number;
  };
  /** Whether this viewer has joined. Present only when authenticated. */
  viewer?: {
    isMember: boolean;
  };
}
