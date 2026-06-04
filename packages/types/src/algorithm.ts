/** Mirrors the ALGORITHM constant. Exposed publicly via GET /algorithm. */
export interface AlgorithmState {
  version: string;
  description: string;
  weights: Record<string, number>;
  parameters: Record<string, number | boolean>;
}

export interface AlgorithmChangelogEntry {
  id: string;
  version: string;
  summary: string;
  detail: string | null;
  changedBy: string;
  commitHash: string;
  deployedAt: string;
}
