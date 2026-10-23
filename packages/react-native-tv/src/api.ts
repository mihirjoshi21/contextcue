import { trimTrailingSlashes } from './format.js';
import type { AskRequest, AskResponse, CreatedSession, SessionState, SpeakResponse } from './types.js';

export type FetchLike = (input: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
}>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly kind: 'network' | 'forbidden' | 'not-found' | 'bad-request' | 'server' | 'parse',
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  apiBaseUrl: string;
  /** Defaults to global fetch (present in RN and Vega). */
  fetch?: FetchLike;
}

function kindFor(status: number): ApiError['kind'] {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status >= 500) return 'server';
  return 'bad-request';
}

/** Pulls `{error}` out of a JSON error body, else returns the raw text. */
export function errorMessageFromBody(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown };
    if (parsed && typeof parsed.error === 'string') return parsed.error;
  } catch {
    // not JSON
  }
  return body.trim() || `Request failed with status ${status}`;
}

export function createApiClient(opts: ApiClientOptions) {
  const base = trimTrailingSlashes(opts.apiBaseUrl);
  const doFetch: FetchLike = opts.fetch ?? ((i, init) => (globalThis as any).fetch(i, init));

  async function request<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    let res;
    try {
      res = await doFetch(`${base}${path}`, {
        method: init.method ?? 'GET',
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : 'Network request failed', null, 'network');
    }
    if (!res.ok) {
      let text = '';
      try {
        text = await res.text();
      } catch {
        // ignore
      }
      throw new ApiError(errorMessageFromBody(text, res.status), res.status, kindFor(res.status));
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new ApiError('Could not parse API response', res.status, 'parse');
    }
  }

  return {
    baseUrl: base,
    createSession: () => request<CreatedSession>('/v1/sessions', { method: 'POST' }),
    getSession: (code: string) => request<SessionState>(`/v1/sessions/${encodeURIComponent(code)}`),
    updateSession: (code: string, tvToken: string, body: { titleId?: string; positionMs?: number; playing?: boolean }) =>
      request<SessionState>(`/v1/sessions/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: { 'X-TV-Token': tvToken },
        body,
      }),
    ask: (body: AskRequest) => request<AskResponse>('/v1/ask', { method: 'POST', body }),
    speak: (text: string, voice?: string) =>
      request<SpeakResponse>('/v1/speak', { method: 'POST', body: voice ? { text, voice } : { text } }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
