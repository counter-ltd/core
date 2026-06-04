// Copyright (c) 2026 Counter (counter.ltd)
// SPDX-License-Identifier: LicenseRef-CSL-1.0
// Licensed under the Counter Social License v1.0. Full terms in LICENSE.md.

/**
 * The single server-side door to the Counter API.
 *
 * Every load function and form action calls through `apiFetch` so that auth
 * headers, JSON encoding, query building, and error shaping all happen in one
 * place. The big promise it makes: it never throws. A network failure or a
 * non-2xx response comes back as a structured `ApiResult` the caller can branch
 * on, so a flaky API turns into a rendered error instead of a 500.
 */
import { env } from '$env/dynamic/public';

// Read the base URL per call, not once at module load. SvelteKit only fills in
// `$env/dynamic/public` after this module is imported, so a top-level constant
// would capture the value before it exists and stay stale forever.
function apiUrl(): string {
  return env.PUBLIC_API_URL || 'http://localhost:3000';
}

/** Outcome of an API call. `ok` mirrors the HTTP status; on failure `error` carries a code+message and `data` is null. */
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
  // Hand in SvelteKit's request-scoped `fetch` during SSR: it dedupes
  // identical requests and lets the result be inlined into the page payload,
  // so the browser doesn't re-fetch on hydration.
  fetch?: typeof globalThis.fetch;
  query?: Record<string, string | number | undefined>;
}

/**
 * Call the API and get back a never-throwing {@link ApiResult}.
 *
 * @param path  API path beginning with "/", e.g. "/users/me".
 * @param opts  Method, bearer token, JSON body, query params, and the fetch to
 *              use. Everything is optional; the defaults make a plain GET.
 */
export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiOptions = {},
): Promise<ApiResult<T>> {
  const { method = 'GET', token, body, fetch: f = fetch, query } = opts;

  let url = `${apiUrl()}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      // Drop undefined and empty params so callers can pass optional filters
      // straight through without first stripping the blank ones.
      if (v !== undefined && v !== '') qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = {};
  // Only declare a JSON content type when we're actually sending a body,
  // otherwise a bare GET would advertise a payload it doesn't have.
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
    // A thrown fetch means the API never answered (DNS, connection refused,
    // timeout). Synthesize a 503 so callers handle "down" with the same
    // ApiResult branch they use for any other failure.
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
    // Empty or non-JSON body (a 204, or an HTML error page). Leave data null
    // rather than letting the parse error escape.
    data = null;
  }

  // Prefer the API's own {error:{code,message}} when it sent one, so the UI can
  // show the server's wording. Fall back to a generic message when the failure
  // body told us nothing useful.
  const error =
    !res.ok && data && typeof data === 'object' && 'error' in data
      ? (data as { error: { code: string; message: string } }).error
      : !res.ok
        ? { code: 'error', message: `Request failed (${res.status})` }
        : null;

  return { ok: res.ok, status: res.status, data: data as T, error };
}
