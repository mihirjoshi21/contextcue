import { randomUUID } from 'node:crypto';
import {
  buildContext,
  buildPrompt,
  spoilerGuard,
  SPOILER_SAFE_FALLBACK,
  type AskMode,
  type ContextOptions
} from '@contextcue/core';
import { buildCitations } from './citations.js';
import { extractCompleteSentences } from './sentences.js';
import { filterSkipRanges } from './skip-ranges.js';
import type { AppDeps } from './app.js';
import type { AskMeta, AskResult, CitationCue, SharedAnswer } from './types.js';

/** Same shape SPEC.md documents for a BCP-47-ish locale tag: 2-3 letter
 * language, then 0-2 subtags of 2-8 alphanumerics (region/script/variant).
 * Deliberately conservative — this is server-side injection defense (the
 * locale flows into the Bedrock prompt), not a full BCP-47 validator. */
const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

export interface AskInput {
  titleId: string;
  positionMs: number;
  question: string;
  mode?: AskMode;
  audience?: 'adult' | 'kids';
  locale?: string;
  contextOpts?: ContextOptions;
  /** The session this ask was made against, if any (already validated to
   * exist by `resolveAskRequest`) — needed so `showOnTv` knows where to
   * write the shared answer. */
  sessionCode?: string;
  /** "Show this on the TV": when true and `sessionCode` is set, the answer
   * is stored on the session as `sharedAnswer` for the Fire TV app to pick
   * up (via GET/PUT /v1/sessions/:code). */
  showOnTv?: boolean;
}

export interface AskResponse {
  answer: string;
  mode: AskMode;
  citations: CitationCue[];
  safeUntilMs: number;
  guard: { passed: boolean; flags: string[] };
  provider: string;
  model: string;
  latencyMs: number;
}

export type AskStreamEvent =
  | { type: 'sentence'; text: string }
  | ({ type: 'done' } & AskResponse)
  | { type: 'error'; message: string };

const VALID_MODES: AskMode[] = ['ask', 'recap', 'who', 'scene'];
const MAX_QUESTION_LENGTH = 500;

/** Used when a mode other than 'ask' is requested with no question text
 * (e.g. a TV remote "Catch me up" chip that has no text input at all). */
export const DEFAULT_QUESTION_BY_MODE: Record<AskMode, string> = {
  ask: '',
  recap: 'Catch me up on what has happened so far.',
  who: "Who's who so far?",
  scene: 'What just happened?'
};

export interface AskRequestBody {
  titleId?: string;
  positionMs?: number;
  question?: string;
  mode?: AskMode;
  sessionCode?: string;
  audience?: 'adult' | 'kids';
  locale?: string;
  showOnTv?: boolean;
}

export interface AskValidationError {
  error: string;
  status: 400 | 404;
}

function normalizeMode(mode: unknown): AskMode {
  return VALID_MODES.includes(mode as AskMode) ? (mode as AskMode) : 'ask';
}

/**
 * Validates + resolves a raw `/v1/ask` (or `/v1/ask/stream`) request body into
 * a ready-to-answer `AskInput`:
 *  - `question` is required only for mode `'ask'`; other modes fall back to a
 *    canned default question (chips like "Catch me up" have no text input).
 *  - `question` over 500 chars is rejected (400).
 *  - `positionMs` must be a non-negative finite number (400 otherwise).
 *  - a `sessionCode` that doesn't resolve to a real session is a 404, not a
 *    silent fall-back to the client's own claimed position.
 *  - `positionMs` is clamped to `min(client, session)` (if a session applies)
 *    and then to the title's `durationMs` — never rejected for being "too far
 *    ahead", just capped to a sane bound.
 */
export async function resolveAskRequest(
  deps: AppDeps,
  body: AskRequestBody
): Promise<AskInput | AskValidationError> {
  const mode = normalizeMode(body.mode);

  let question = typeof body.question === 'string' ? body.question : '';
  if (question.length > MAX_QUESTION_LENGTH) {
    return { error: `question must be ${MAX_QUESTION_LENGTH} characters or fewer`, status: 400 };
  }
  if (mode === 'ask' && question.trim().length === 0) {
    return { error: 'question is required for mode "ask"', status: 400 };
  }
  if (question.trim().length === 0) {
    question = DEFAULT_QUESTION_BY_MODE[mode];
  }

  if (body.locale !== undefined && !LOCALE_RE.test(body.locale)) {
    return { error: 'locale must look like a BCP-47 language tag (e.g. "en", "en-US")', status: 400 };
  }

  if (!body.titleId) {
    return { error: 'titleId is required', status: 400 };
  }
  if (typeof body.positionMs !== 'number' || !Number.isFinite(body.positionMs) || body.positionMs < 0) {
    return { error: 'positionMs must be a non-negative finite number', status: 400 };
  }

  let titleId = body.titleId;
  let positionMs = body.positionMs;

  // A companion can never ask ahead of the TV: when a sessionCode is given, it
  // must resolve to a real session (404 otherwise — no silent fall-back), and
  // the effective position is the MIN of the client's and the session's.
  if (body.sessionCode) {
    const session = await deps.sessionStore.get(body.sessionCode);
    if (!session) return { error: 'session not found', status: 404 };
    if (session.titleId) titleId = session.titleId;
    positionMs = Math.min(positionMs, session.positionMs);
  }

  const title = await deps.contentStore.getTitle(titleId);
  if (!title) return { error: 'title not found', status: 404 };

  positionMs = Math.min(positionMs, title.durationMs);

  return {
    titleId,
    positionMs,
    question,
    mode,
    audience: body.audience,
    locale: body.locale,
    sessionCode: body.sessionCode,
    showOnTv: body.showOnTv
  };
}

/** Writes the answer onto the session as `sharedAnswer` when `showOnTv` was
 * requested — a no-op unless both `sessionCode` and `showOnTv: true` are
 * present on the input (i.e. `resolveAskRequest` already confirmed the
 * session exists). Failures here never fail the ask itself. */
async function maybeShowOnTv(
  deps: AppDeps,
  input: Pick<AskInput, 'sessionCode' | 'showOnTv' | 'question'>,
  response: Pick<AskResponse, 'answer' | 'citations' | 'mode'>
): Promise<void> {
  if (!input.sessionCode || !input.showOnTv) return;
  const sharedAnswer: SharedAnswer = {
    id: randomUUID(),
    question: input.question,
    answer: response.answer,
    citations: response.citations,
    mode: response.mode,
    createdAt: Date.now()
  };
  try {
    await deps.sessionStore.update(input.sessionCode, { sharedAnswer });
  } catch {
    // Sharing to the TV is best-effort — never fail the ask over it.
  }
}

/** One CloudWatch Embedded Metric Format (EMF) log line per ask — CloudWatch
 * Logs auto-extracts this as metrics (Namespace `ContextCue`) with no extra
 * dependency: it just has to be valid EMF JSON on Lambda's stdout. */
function emitAskMetric(params: {
  provider: string;
  mode: AskMode;
  latencyMs: number;
  guardFlagCount: number;
  usage?: AskResult['usage'];
}): void {
  const u = params.usage;
  const usageMetrics: [string, number | undefined][] = [
    ['InputTokens', u?.inputTokens],
    ['OutputTokens', u?.outputTokens],
    ['CacheReadInputTokens', u?.cacheReadInputTokens],
    ['CacheWriteInputTokens', u?.cacheWriteInputTokens]
  ];
  const present = usageMetrics.filter(([, v]) => typeof v === 'number') as [string, number][];
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'ContextCue',
            Dimensions: [['Provider', 'Mode']],
            Metrics: [
              { Name: 'LatencyMs', Unit: 'Milliseconds' },
              { Name: 'GuardFlags', Unit: 'Count' },
              ...present.map(([Name]) => ({ Name, Unit: 'Count' }))
            ]
          }
        ]
      },
      Provider: params.provider,
      Mode: params.mode,
      LatencyMs: params.latencyMs,
      GuardFlags: params.guardFlagCount,
      ...Object.fromEntries(present)
    })
  );
}

/**
 * The single spoiler-safe answer pipeline, shared by POST /v1/ask and the MCP tools:
 * load cues -> build a bounded context (hard ceiling at positionMs) -> build the prompt
 * (title withheld by default) -> ask the provider -> run the leak guard -> derive citations
 * that can never point past the safe position.
 */
/**
 * Names the viewer typed themselves are not a world-knowledge leak when the model echoes them
 * ("What's wrong with Karen?" -> "Karen hasn't been named yet"), so they're allowed by the guard.
 */
function guardAllowedNames(deps: AppDeps, question: string | undefined): string[] {
  const fromQuestion = (question ?? '').match(/[A-Z][A-Za-z'-]+/g) ?? [];
  return [...(deps.provider.guardAllowedNames ?? []), ...fromQuestion.map((w) => w.replace(/['’]s$/, ''))];
}

export async function answerQuestion(deps: AppDeps, input: AskInput): Promise<AskResponse> {
  const started = Date.now();
  const mode: AskMode = VALID_MODES.includes(input.mode as AskMode) ? (input.mode as AskMode) : 'ask';

  const [cues, title] = await Promise.all([
    deps.contentStore.getCues(input.titleId),
    deps.contentStore.getTitle(input.titleId)
  ]);
  const watchedCues = filterSkipRanges(cues, title?.skipRanges);
  const context = buildContext(watchedCues, input.positionMs, input.question, input.contextOpts);

  const built = buildPrompt({
    mode,
    question: input.question,
    context,
    audience: input.audience,
    locale: input.locale
  });

  const meta: AskMeta = { mode, question: input.question };
  const result = await deps.provider.ask(built, context, meta);
  // A provider error returns our own fixed fallback text, not model output: don't run the
  // leak guard over it (it would flag words like "AI" and mangle the message) and don't cite.
  const guard = result.error
    ? { passed: false, flags: ['provider-error'], sanitized: result.text }
    : spoilerGuard(result.text, context, { allowedNames: guardAllowedNames(deps, input.question) });
  const flags = [...guard.flags, ...(result.flags ?? [])];

  const safeUntilMs = context.maxCueStartMs;
  const citations = result.error ? [] : buildCitations(guard.sanitized, context, safeUntilMs);
  const latencyMs = Date.now() - started;

  emitAskMetric({ provider: deps.provider.name, mode, latencyMs, guardFlagCount: flags.length, usage: result.usage });

  const response: AskResponse = {
    answer: guard.sanitized,
    mode,
    citations,
    safeUntilMs,
    guard: { passed: flags.length === 0, flags },
    provider: deps.provider.name,
    model: result.model,
    latencyMs
  };

  if (!result.error) await maybeShowOnTv(deps, input, response);

  return response;
}

/**
 * Streaming counterpart of `answerQuestion`, used by `POST /v1/ask/stream`
 * (SSE): buffers the provider's raw text chunks into complete sentences and
 * runs `spoilerGuard` on each one *before* emitting it — a sentence the guard
 * flags is silently dropped (never sent), not sent-then-retracted. Ends with
 * one `done` event carrying the same shape as `answerQuestion`'s response.
 */
export async function* answerQuestionStream(deps: AppDeps, input: AskInput): AsyncGenerator<AskStreamEvent> {
  const started = Date.now();
  const mode: AskMode = VALID_MODES.includes(input.mode as AskMode) ? (input.mode as AskMode) : 'ask';

  const [cues, title] = await Promise.all([
    deps.contentStore.getCues(input.titleId),
    deps.contentStore.getTitle(input.titleId)
  ]);
  const watchedCues = filterSkipRanges(cues, title?.skipRanges);
  const context = buildContext(watchedCues, input.positionMs, input.question, input.contextOpts);

  const built = buildPrompt({
    mode,
    question: input.question,
    context,
    audience: input.audience,
    locale: input.locale
  });

  const meta: AskMeta = { mode, question: input.question };

  const emitted: string[] = [];
  const flags: string[] = [];
  let buffer = '';

  const guardAndMaybeEmit = function* (sentence: string): Generator<AskStreamEvent> {
    const trimmed = sentence.trim();
    if (!trimmed) return;
    const guard = spoilerGuard(trimmed, context, { allowedNames: guardAllowedNames(deps, input.question) });
    if (guard.passed) {
      // Preserve line structure: a unit that ended in a newline keeps it.
      const text = sentence.endsWith('\n') ? guard.sanitized + '\n' : guard.sanitized;
      emitted.push(text);
      yield { type: 'sentence', text };
    } else {
      flags.push(...guard.flags);
    }
  };

  try {
    for await (const chunk of deps.provider.askStream(built, context, meta)) {
      buffer += chunk;
      const { sentences, rest } = extractCompleteSentences(buffer);
      buffer = rest;
      for (const sentence of sentences) yield* guardAndMaybeEmit(sentence);
    }
    if (buffer.trim()) yield* guardAndMaybeEmit(buffer);
  } catch {
    yield { type: 'error', message: 'The AI provider stream failed.' };
  }

  const answer =
    emitted.length > 0
      ? emitted.map((t, i) => (i < emitted.length - 1 && !t.endsWith('\n') ? t + ' ' : t)).join('').trim()
      : SPOILER_SAFE_FALLBACK;
  const safeUntilMs = context.maxCueStartMs;
  const citations = buildCitations(answer, context, safeUntilMs);
  const latencyMs = Date.now() - started;

  emitAskMetric({ provider: deps.provider.name, mode, latencyMs, guardFlagCount: flags.length });

  const doneResponse: AskResponse = {
    answer,
    mode,
    citations,
    safeUntilMs,
    guard: { passed: flags.length === 0, flags },
    provider: deps.provider.name,
    model: deps.provider.model,
    latencyMs
  };

  await maybeShowOnTv(deps, input, doneResponse);

  yield { type: 'done', ...doneResponse };
}
