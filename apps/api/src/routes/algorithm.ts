import { Hono } from 'hono';
import { db, algorithmChangelog, desc } from '@counter/db';
import { ALGORITHM } from '@counter/config';
import type { AlgorithmState, AlgorithmChangelogEntry } from '@counter/types';
import type { AppEnv } from '../types.ts';

export const algorithmRoutes = new Hono<AppEnv>();

/**
 * The ranking algorithm, exposed verbatim. This is the same ALGORITHM constant
 * the feed service ranks with — what you read here is what actually runs.
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
