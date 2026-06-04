import { env } from '$env/dynamic/private';

/** Base URL of the Counter API. The web client is a thin layer over this. */
export const API_URL = env.PUBLIC_API_URL || 'http://localhost:3000';

export interface ApiResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  error: { code: string; message: string } | null;
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  token?: string | null;
  body?: unknown;
  /** Pass the SvelteKit `fetch` when available for SSR fetch dedup. */
  fetch?: typeof globalThis.fetch;
  query?: Record<string, string | number | undefined>;
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiOptions = {},
): Promise<ApiResult<T>> {
  const { method = 'GET', token, body, fetch: f = fetch, query } = opts;

  let url = `${API_URL}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await f(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return {
      ok: false,
      status: 503,
      data: null as T,
      error: { code: 'api_unreachable', message: 'The API is unreachable' },
    };
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  const error =
    !res.ok && data && typeof data === 'object' && 'error' in data
      ? (data as { error: { code: string; message: string } }).error
      : !res.ok
        ? { code: 'error', message: `Request failed (${res.status})` }
        : null;

  return { ok: res.ok, status: res.status, data: data as T, error };
}
