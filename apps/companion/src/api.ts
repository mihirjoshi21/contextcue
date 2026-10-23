// Typed HTTP client for the ContextCue API (services/api), per SPEC.md "HTTP API".
// Talks to relative /v1/* paths: in dev, vite.config.ts proxies /v1 -> localhost:8787;
// in prod the companion is served by the API itself at /companion, same origin.

export type AskMode = 'ask' | 'recap' | 'who' | 'scene';

export interface Title {
  id: string;
  title: string;
  durationMs: number;
  poster?: string;
  videoUrl: string;
  hasSubtitles: boolean;
  license: string;
}

export interface SessionState {
  code: string;
  /** Absent until the TV's first PUT (session was just created via POST /v1/sessions). */
  titleId?: string;
  positionMs: number;
  playing: boolean;
  /** Denormalized convenience fields some API implementations may include. */
  title?: string;
  durationMs?: number;
  updatedAt?: number;
}

export interface Citation {
  startMs: number;
  endMs: number;
  text: string;
}

export interface GuardInfo {
  passed: boolean;
  flags: string[];
}

export interface AskRequest {
  titleId: string;
  positionMs: number;
  question: string;
  mode?: AskMode;
  sessionCode?: string;
  audience?: 'adult' | 'kids';
  locale?: string;
  /** Pop the answer up on the TV too, for the whole family. */
  showOnTv?: boolean;
}

export interface AskResponse {
  answer: string;
  mode: AskMode;
  citations: Citation[];
  safeUntilMs: number;
  guard: GuardInfo;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface SpeakRequest {
  text: string;
  voice?: string;
}

export interface SpeakResponse {
  audioBase64: string;
  contentType: string;
  /**
   * Mock provider returns empty `audioBase64` + a flag (see SPEC.md POST /v1/speak).
   * Confirmed live against services/api: the mock speech provider sends `error: true`
   * alongside an empty `audioBase64` (rather than a `mock` field) — both are checked.
   */
  mock?: boolean;
  error?: boolean;
  flags?: string[];
}

export interface CharacterInfo {
  name: string;
  firstSeenMs: number;
  mentions: number;
}

/** Thrown for any non-2xx response or network/parse failure. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly kind: 'not-found' | 'network' | 'server' | 'unknown';

  constructor(message: string, status: number | null, kind: ApiError['kind']) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.kind = kind;
  }
}

function apiBase(): string {
  // Allow override for alternate deployments; defaults to same-origin relative paths
  // (works both against the dev proxy and when the API serves this app at /companion).
  try {
    return import.meta.env.VITE_API_BASE ?? '';
  } catch {
    return '';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    throw new ApiError(
      err instanceof Error ? err.message : 'Network request failed',
      null,
      'network',
    );
  }

  if (!res.ok) {
    const kind = res.status === 404 ? 'not-found' : res.status >= 500 ? 'server' : 'unknown';
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new ApiError(
      detail || `Request failed with status ${res.status}`,
      res.status,
      kind,
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError('Could not parse API response', res.status, 'unknown');
  }
}

export function getTitles(): Promise<Title[]> {
  return request<Title[]>('/v1/titles');
}

export function createSession(): Promise<{ code: string }> {
  return request<{ code: string }>('/v1/sessions', { method: 'POST' });
}

export function getSession(code: string): Promise<SessionState> {
  return request<SessionState>(`/v1/sessions/${encodeURIComponent(code)}`);
}

export function updateSession(
  code: string,
  body: { titleId: string; positionMs: number; playing: boolean },
): Promise<SessionState> {
  return request<SessionState>(`/v1/sessions/${encodeURIComponent(code)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function ask(body: AskRequest): Promise<AskResponse> {
  return request<AskResponse>('/v1/ask', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Streaming ask (POST /v1/ask/stream, Server-Sent Events over a POST body).
// Not EventSource (GET-only): we parse the SSE wire format ourselves from a
// fetch() ReadableStream. Events: `sentence` {text}, `done` {answer, citations,
// guard, latencyMs, safeUntilMs}, `error` {message} | string.
// ---------------------------------------------------------------------------

export interface AskStreamSentenceEvent {
  type: 'sentence';
  text: string;
}

export interface AskStreamDoneEvent {
  type: 'done';
  answer: string;
  citations: Citation[];
  guard: GuardInfo;
  latencyMs: number;
  safeUntilMs: number;
}

export interface AskStreamErrorEvent {
  type: 'error';
  message: string;
}

export type AskStreamEvent = AskStreamSentenceEvent | AskStreamDoneEvent | AskStreamErrorEvent;

/** Thrown when POST /v1/ask/stream 404s — callers should fall back to ask(). */
export class StreamUnsupportedError extends Error {
  constructor() {
    super('Streaming ask endpoint not available');
    this.name = 'StreamUnsupportedError';
  }
}

interface RawSseEvent {
  event: string;
  data: string;
}

/**
 * Incremental SSE parser: feed it arbitrarily-sized chunks (which may split an
 * event's "event:"/"data:" lines, or even the "\n\n" terminator, across chunk
 * boundaries) and it returns any events completed by that chunk. Exported so
 * chunk-boundary edge cases can be unit-tested without a real network stream.
 */
export function createSseParser(): { push: (chunk: string) => RawSseEvent[] } {
  let buffer = '';
  return {
    push(chunk: string): RawSseEvent[] {
      buffer += chunk.replace(/\r\n/g, '\n');
      const events: RawSseEvent[] = [];
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseRawEvent(raw);
        if (parsed) events.push(parsed);
      }
      return events;
    },
  };
}

/** Returns null for comment-only / data-less blocks (e.g. ":keep-alive"), which dispatch nothing. */
function parseRawEvent(raw: string): RawSseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith(':')) continue; // comment / keep-alive
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).replace(/^ /, ''));
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

async function* consumeSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<RawSseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const evt of parser.push(decoder.decode(value, { stream: true }))) {
        yield evt;
      }
    }
    for (const evt of parser.push(decoder.decode())) {
      yield evt;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Streams an answer sentence-by-sentence from POST /v1/ask/stream.
 * Throws StreamUnsupportedError on a 404 (endpoint not deployed yet) so callers
 * can fall back to ask(); throws ApiError for other transport failures.
 */
export async function* askStream(body: AskRequest): AsyncGenerator<AskStreamEvent> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}/v1/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : 'Network request failed', null, 'network');
  }

  if (res.status === 404) {
    throw new StreamUnsupportedError();
  }
  if (!res.ok || !res.body) {
    throw new ApiError(`Request failed with status ${res.status}`, res.status, res.status >= 500 ? 'server' : 'unknown');
  }

  for await (const raw of consumeSseStream(res.body)) {
    if (!raw.data) continue;
    if (raw.event === 'sentence') {
      const parsed = JSON.parse(raw.data) as { text: string };
      yield { type: 'sentence', text: parsed.text };
    } else if (raw.event === 'done') {
      const parsed = JSON.parse(raw.data) as Omit<AskStreamDoneEvent, 'type'>;
      yield { type: 'done', ...parsed };
    } else if (raw.event === 'error') {
      let message = 'The stream reported an error.';
      try {
        const parsed = JSON.parse(raw.data) as { message?: string } | string;
        message = typeof parsed === 'string' ? parsed : (parsed.message ?? message);
      } catch {
        message = raw.data;
      }
      yield { type: 'error', message };
    }
    // Unknown event names are ignored (forward-compatible).
  }
}

export function speak(body: SpeakRequest): Promise<SpeakResponse> {
  return request<SpeakResponse>('/v1/speak', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getCharacters(
  titleId: string,
  positionMs: number,
  sessionCode?: string,
): Promise<CharacterInfo[]> {
  const params: Record<string, string> = { positionMs: String(Math.max(0, Math.floor(positionMs))) };
  if (sessionCode) params.sessionCode = sessionCode;
  const qs = new URLSearchParams(params);
  return request<CharacterInfo[]>(
    `/v1/titles/${encodeURIComponent(titleId)}/characters?${qs.toString()}`,
  );
}

/**
 * Normalizes user-entered session codes: strips whitespace/punctuation, uppercases,
 * and truncates to the server's 6-character code length. Session codes are generated
 * server-side "with no ambiguous chars" (see SPEC.md) but we don't assume a specific
 * alphabet here — only uppercase + strip non-alphanumerics, so paste-from-anywhere
 * (URLs, "code: AB12CD", spaces) still works.
 */
export function normalizeSessionCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

export function isValidSessionCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}

export function formatTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
