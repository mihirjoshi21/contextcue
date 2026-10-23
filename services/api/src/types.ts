import type { AskMode, BuiltPrompt, SpoilerSafeContext, Cue } from '@contextcue/core';

export interface AskResult {
  text: string;
  model: string;
  error?: boolean;
  /** Token usage reported by the model API (Bedrock Converse `usage`). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheWriteInputTokens?: number;
  };
  /** Extra guard-style flags the provider itself wants surfaced in the response's
   * `guard.flags` (e.g. `'bedrock-guardrail'` when a Bedrock Guardrail intervened). */
  flags?: string[];
}

/** Everything a provider needs about *why* it's being asked, beyond the
 * rendered prompt text — so a mode-aware provider (the mock one) doesn't have
 * to sniff `built.user`/`built.system` to recover the mode/question. */
export interface AskMeta {
  mode: AskMode;
  question: string;
}

export interface AiProvider {
  name: 'bedrock' | 'mock';
  model: string;
  /** Proper-noun-looking words the provider's own scaffolding text may introduce
   * (e.g. MockProvider's "Offline demo mode" preface) that `spoilerGuard`
   * should never flag as a possible world-knowledge leak — they aren't part
   * of the transcript, so the guard's context-membership check can't see
   * them, but they also aren't a leak since the provider itself put them there. */
  guardAllowedNames?: string[];
  ask(built: BuiltPrompt, context: SpoilerSafeContext, meta: AskMeta): Promise<AskResult>;
  /** Yields raw text deltas/chunks as they become available. The caller (see
   * `src/ask.ts`'s `answerQuestionStream`) buffers these into complete sentences
   * and runs `spoilerGuard` on each one before ever emitting it — an unguarded
   * partial sentence is never surfaced to a client. */
  askStream(built: BuiltPrompt, context: SpoilerSafeContext, meta: AskMeta): AsyncIterable<string>;
}

export interface SpeechResult {
  audioBase64: string;
  contentType: string;
  error?: boolean;
}

export interface Speech {
  name: 'polly' | 'mock';
  synthesize(text: string, voice?: string): Promise<SpeechResult>;
}

export interface SharedAnswer {
  id: string;
  question: string;
  answer: string;
  citations: CitationCue[];
  mode: AskMode;
  createdAt: number;
}

export interface SessionState {
  code: string;
  titleId?: string;
  positionMs: number;
  playing: boolean;
  updatedAt: number;
  /** Set when an ask (POST /v1/ask[/stream] with `showOnTv: true`) chose to
   * "show this on the TV" — the last such answer for this session, so the
   * Fire TV app (polling/re-fetching the session) can display it. */
  sharedAnswer?: SharedAnswer;
  /** SHA-256 hex hash of the TV token required to PUT this session (see
   * `src/tv-token.ts`). Never the plaintext token, and never included in any
   * client-facing response — `src/app.ts`'s `toPublicSession` strips it
   * before every GET/PUT response body. */
  tvTokenHash?: string;
}

/** What `SessionStore.create()` returns: the new session's public state, plus
 * the plaintext TV token — visible ONLY here, ONLY once (`POST /v1/sessions`'
 * response). It is never persisted in plaintext and never returned again by
 * any other call. */
export interface CreatedSession extends SessionState {
  tvToken: string;
}

export interface SessionStore {
  create(): Promise<CreatedSession>;
  get(code: string): Promise<SessionState | undefined>;
  update(
    code: string,
    patch: Partial<Pick<SessionState, 'titleId' | 'positionMs' | 'playing' | 'sharedAnswer' | 'tvTokenHash'>>
  ): Promise<SessionState | undefined>;
}

export interface SkipRange {
  startMs: number;
  endMs: number;
  label: string;
}

export interface TitleMeta {
  id: string;
  title: string;
  durationMs: number;
  videoUrl: string;
  subtitles: string;
  license: string;
  poster?: string;
  /** Where actual story content starts (ms) — e.g. a TV-broadcast rip with a
   * host intro before the film itself. Passed through as-is; playback UIs
   * should seek here by default instead of 0. */
  playbackStartMs?: number;
  /** Non-story spans to skip during playback (e.g. a broadcast host's intro
   * or outro baked into the video file). Passed through as-is. */
  skipRanges?: SkipRange[];
}

export interface TitleListItem {
  id: string;
  title: string;
  durationMs: number;
  poster?: string;
  videoUrl: string;
  hasSubtitles: boolean;
  license: string;
  playbackStartMs?: number;
  skipRanges?: SkipRange[];
}

/** A poster image served back byte-for-byte by `GET /v1/posters/:file`. `body` is a
 * `Uint8Array` for a small locally-buffered file (FsContentStore) or a `ReadableStream`
 * piped straight through from S3 (S3ContentStore) — both are valid `BodyInit` for a
 * `Response`, so the route handler doesn't need to care which store produced it. */
export interface PosterAsset {
  body: Uint8Array | ReadableStream<Uint8Array>;
  contentType: string;
}

export interface ContentStore {
  listTitles(): Promise<TitleMeta[]>;
  getTitle(id: string): Promise<TitleMeta | undefined>;
  getCues(id: string): Promise<Cue[]>;
  /** Looks up a poster image by its bare filename (already validated by the caller —
   * see `isSafePosterFilename` in app.ts — but implementations should still resolve
   * defensively rather than trust it). Returns undefined if missing. */
  getPoster(file: string): Promise<PosterAsset | undefined>;
}

export interface CitationCue {
  startMs: number;
  endMs: number;
  text: string;
}

export type { Cue };
