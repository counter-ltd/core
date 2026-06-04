import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/server/api';
import type { AlgorithmState, AlgorithmChangelogEntry, Page } from '@counter/types';

export const load: PageServerLoad = async ({ fetch }) => {
  const [stateRes, logRes] = await Promise.all([
    apiFetch<AlgorithmState>('/algorithm', { fetch }),
    apiFetch<Page<AlgorithmChangelogEntry>>('/algorithm/changelog', { fetch }),
  ]);
  return {
    algorithm: stateRes.ok ? stateRes.data : null,
    changelog: logRes.ok ? logRes.data.data : [],
  };
};
