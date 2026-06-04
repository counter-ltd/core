// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * Public window onto the feed-ranking algorithm.
 *
 * Counter's pitch is that the ranking isn't a secret. These routes serve the
 * live algorithm config and a history of how it has changed, so anyone can see
 * exactly what decides the order of their feed.
 */
import { Hono } from 'hono';
import { db, algorithmChangelog, desc } from '@counter/db';
import { ALGORITHM } from '@counter/config';
import type { AlgorithmState, AlgorithmChangelogEntry } from '@counter/types';
import type { AppEnv } from '../types.ts';

export const algorithmRoutes = new Hono<AppEnv>();

/**
 * The ranking algorithm, exposed verbatim. This is the same ALGORITHM constant
 * the feed service ranks with, so what you read here is what actually runs.
 */
algorithmRoutes.get('/', (c) => {
  const state: AlgorithmState = {
    version: ALGORITHM.version,
    description: ALGORITHM.description,
    weights: { ...ALGORITHM.weights },
    parameters: { ...ALGORITHM.parameters },
  };
  return c.json(state);
});

// --- changelog ---

// Every tweak to weights or parameters lands here as a row, newest first, so
// the public can audit how ranking has shifted over time. Capped at 100 because
// this feeds a "what changed" view, not a full forensic export.
algorithmRoutes.get('/changelog', async (c) => {
  const rows = await db
    .select()
    .from(algorithmChangelog)
    .orderBy(desc(algorithmChangelog.deployedAt))
    .limit(100);

  const data: AlgorithmChangelogEntry[] = rows.map((r) => ({
    id: r.id,
    version: r.version,
    summary: r.summary,
    detail: r.detail,
    changedBy: r.changedBy,
    commitHash: r.commitHash,
    deployedAt: r.deployedAt.toISOString(),
  }));
  return c.json({ data, nextCursor: null });
});
