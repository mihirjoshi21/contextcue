# ContextCue — Build Spec (API and package contracts)

> The product name lives in ONE constant per package so it is easy to rename.
> A spoiler-proof AI viewing companion for Fire TV. Pause, ask "who is that?" / "why did she do that?" / "catch me up",
> get an answer grounded ONLY in dialogue that has already played. Nothing after the playhead ever reaches the model.

## Hackathon targeting (every decision must serve these)
- **Primary: Fire TV track** — must visibly run on Fire OS (Android APK on Fire TV device or emulator) or Vega simulator.
  Priority categories hit: AI-enhanced viewing, multi-modal UX, family entertainment.
- **Mini: AWS Builder** — Amazon Bedrock (Converse API, Claude), Lambda, API Gateway (HTTP API), DynamoDB, Polly (spoken answers), Transcribe (generate subtitles when a title has none), CDK. Integrations must be REAL code paths, documented.
- **Mini: Open Source** — `packages/core` is a standalone MIT library: "spoiler-safe subtitle windowing + retrieval + prompt building + leak guard".
- **Bonus ecosystem reach**: an MCP server (spec 2025-11-25, Streamable HTTP) so Alexa+ can answer "Alexa, who's that guy?" about what's playing on the TV.
- Judging: Tech Implementation, Design, Potential Impact, Quality of Idea. Friction logs = up to +10%.

## Repo layout (npm workspaces, Node >= 20, TypeScript strict, ESM, vitest)
```
/package.json               workspaces: packages/*, services/*, apps/companion
/packages/core              @contextcue/core  (MIT, zero runtime deps preferred)
/services/api               @contextcue/api   (Hono app: runs locally on node AND as AWS Lambda; includes /mcp)
/infra                      AWS CDK app (TypeScript)
/apps/companion             Vite + React phone companion web app (served by api at /companion in prod, or vite dev)
/apps/firetv-android        Kotlin, Jetpack Compose for TV + Media3 ExoPlayer, Gradle (Fire OS APK)
/content                    titles.json + subtitles (.srt/.vtt); video files are NOT committed (download script)
/docs                       architecture, friction log, screenshots
```

## Core library API (`@contextcue/core`) — exact exports
```ts
export interface Cue { index: number; startMs: number; endMs: number; text: string }
export function parseSrt(text: string): Cue[];
export function parseVtt(text: string): Cue[];
export function parseSubtitles(text: string, format?: 'srt' | 'vtt'): Cue[]; // autodetect
export function cuesUpTo(cues: Cue[], positionMs: number): Cue[]; // HARD CEILING: only cues with startMs <= positionMs; text of a cue straddling T is kept (it is on screen)
export interface ContextOptions { recentWindowMs?: number /*default 180000*/; maxChars?: number /*default 24000*/; retrieveK?: number /*default 12*/ }
export interface SpoilerSafeContext {
  positionMs: number; recent: Cue[]; retrieved: Cue[]; full: boolean; // full=true when entire past fits in budget
  cueCount: number; charCount: number; maxCueStartMs: number; // maxCueStartMs <= positionMs ALWAYS (invariant, asserted)
}
export function buildContext(cues: Cue[], positionMs: number, question: string, opts?: ContextOptions): SpoilerSafeContext;
  // if all past cues fit in maxChars => include all (full=true). Else: last recentWindowMs verbatim + BM25 top-K older cues relevant to question (+ neighbors), chronological.
export type AskMode = 'ask' | 'recap' | 'who' | 'scene';
export interface PromptInput { mode: AskMode; question: string; context: SpoilerSafeContext; titleHint?: string; withholdTitle?: boolean /*default true*/; audience?: 'adult'|'kids'; locale?: string }
export interface BuiltPrompt { system: string; user: string; maxTokens: number }
export function buildPrompt(input: PromptInput): BuiltPrompt;
  // System prompt rules: answer ONLY from provided transcript; never use outside knowledge of this story even if recognized;
  // never speculate about future events; if unknown so far, say it hasn't been revealed yet; <= 3 short sentences (recap <= 5); cite timestamps like [12:04].
  // withholdTitle: do NOT pass the title to the model (reduces LLM world-knowledge spoilers for famous films).
export interface GuardResult { passed: boolean; flags: string[]; sanitized: string }
export function spoilerGuard(answer: string, context: SpoilerSafeContext, opts?: { allowedNames?: string[] }): GuardResult;
  // defense-in-depth: flag future-tense speculation ("will later", "eventually", "turns out", "in the end", "spoiler"),
  // proper nouns not present anywhere in context text (possible world-knowledge leak), timestamps cited > positionMs.
  // sanitized = answer with offending sentences removed; if nothing left, a safe fallback line.
export function extractCharacters(cues: Cue[], positionMs: number): { name: string; firstSeenMs: number; mentions: number }[]; // heuristic, past-only
export function formatTimestamp(ms: number): string; // "1:02:03" or "12:04"
```

## HTTP API (`services/api`, Hono). JSON. CORS open. Port 8787 locally.
- `GET  /health` → `{ ok: true, provider: 'bedrock'|'mock' }`
- `GET  /v1/titles` → `[{ id, title, durationMs, poster?, videoUrl, hasSubtitles, license, playbackStartMs?, skipRanges? }]` (from content/titles.json, passed through as-is)
   - `playbackStartMs?: number` — where actual story content starts; set when the source video has a non-story lead-in (e.g. a TV-broadcast rip with a host intro). Playback UIs should seek here by default instead of 0.
   - `skipRanges?: { startMs, endMs, label }[]` — non-story spans to skip during playback (host intro/outro baked into the video file, etc).
- `POST /v1/ask` body `{ titleId, positionMs, question?, mode?: AskMode, sessionCode?, audience?, locale?, showOnTv? }`
   → `{ answer, mode, citations: [{ startMs, endMs, text }], safeUntilMs, guard: { passed, flags }, provider, model, latencyMs }`
   - `question` is required only for `mode: 'ask'` (or when `mode` is omitted, which defaults to `'ask'`); other modes fall back to a canned default question (a TV remote chip like "Catch me up" has no text input). Max 500 chars (400 if longer).
   - `positionMs` must be a non-negative finite number (400 otherwise); it's clamped to the title's `durationMs`, never rejected for being past the end.
   - If `sessionCode` is given, it must resolve to a real session (**404** `{ error: 'session not found' }` otherwise — no silent fallback to the client's own position). The server then uses the session's `titleId` and `min(client positionMs, session positionMs)` — a companion can never ask past the TV.
   - `showOnTv?: boolean` — when true *and* `sessionCode` resolved to a real session, the answer is stored on that session as `sharedAnswer: { id, question, answer, citations, mode, createdAt }` (see `/v1/sessions/:code` below) so the Fire TV app can display it (e.g. a companion asked something and chose to "show this on the TV").
- `POST /v1/ask/stream` — same request body/validation as `POST /v1/ask`; **Server-Sent Events** response instead of a single JSON body: zero or more `event: sentence` frames (`data: { type: 'sentence', text }`), each only ever a sentence that has already passed the spoiler guard (a flagged sentence is dropped silently, never sent-then-retracted), followed by exactly one `event: done` frame carrying the same shape as `POST /v1/ask`'s response (plus `type: 'done'`). `POST /v1/ask` itself is unchanged/non-streaming.
- `POST /v1/speak` `{ text, voice? }` → `{ audioBase64, contentType: 'audio/mpeg' }` (Amazon Polly neural; mock returns empty + flag)
- `POST /v1/sessions` → `{ code, tvToken }` — `code` is the 6-char, no-ambiguous-chars join code (stays shareable: anyone with it can `GET`/`ask` against the session). `tvToken` is a separate, higher-entropy secret (24+ url-safe chars), returned **only here, only once** — the server stores just a hash of it, never the plaintext, and no other endpoint ever returns it.
- `PUT /v1/sessions/:code` requires header `X-TV-Token: <tvToken>` matching the session's stored hash, or **403** `{ error: 'invalid or missing X-TV-Token' }` (a wrong/missing token never mutates the session, whether or not the code itself is right). Body `{ titleId?, positionMs?, playing? }`:
   - `titleId`, if given, must exist in the catalog (**404** `{ error: 'title not found' }` otherwise).
   - `positionMs`, if given, must be a non-negative finite number (400 otherwise) and is clamped to the (possibly just-updated) title's `durationMs`.
   - `playing`, if given, must be a boolean (400 otherwise).
   - → the full updated session state (see GET below, same redaction); unspecified fields are left unchanged.
- `GET /v1/sessions/:code` → `{ code, titleId?, positionMs, playing, updatedAt, sharedAnswer? }` — no auth required (the join code is shareable for read/ask). `sharedAnswer` is present once any `showOnTv: true` ask has been made against this session (see above — `showOnTv` only needs the join code, since it's an append-only display write, not a position/title change), and is `{ id, question, answer, citations, mode, createdAt }`. The stored TV-token hash is never included in this (or any) response.
- `GET  /v1/titles/:id/characters?positionMs=&sessionCode=` → extractCharacters output, cues inside any of the title's `skipRanges` excluded first (see below). `positionMs` must be a non-negative finite number (400 otherwise), clamped to the title's `durationMs`. Optional `sessionCode`: the **session's `titleId` wins over the URL's `:id`** — if the session has no `titleId` yet, returns `[]` (nothing watched); if the session's `titleId` differs from `:id`, **409** `{ error: 'title does not match session' }`; otherwise `positionMs` is `min(client, session)` as with `/v1/ask`. An unresolvable `sessionCode` is still a 404.
- `locale` (on `/v1/ask`, `/v1/ask/stream`) must match `/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/` (400 otherwise) — a BCP-47-ish language tag, validated at the HTTP boundary since it flows into the model prompt; `core.buildPrompt` also defensively drops (rather than trusts) a `locale` that fails this same check, for any other caller.
- `skipRanges` (see `GET /v1/titles` above) are excluded from cues **before** `buildContext`, `extractCharacters`, or any MCP tool answer ever sees them — a cue that starts inside a skip range was never actually watched, so it's treated exactly like a future cue: never surfaced.
- `POST /mcp` / `GET /mcp` — MCP Streamable HTTP (protocol 2025-11-25). Tools: `get_now_playing(sessionCode)`, `ask_spoiler_free(sessionCode, question)`, `catch_me_up(sessionCode, minutes?)`, `who_is(sessionCode, description)`.
- Provider selection: `PROVIDER=bedrock|mock` (default mock if no AWS creds). Bedrock uses Converse API, `BEDROCK_MODEL_ID` env (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`), region `AWS_REGION` default us-east-1.
  Mock provider: deterministic, mode-aware extractive answer built from context cues — clearly labeled as offline-demo mode in recap responses (so a judge/demo run never mistakes it for a real model) — so the whole demo works offline. `ask` picks cues overlapping the question's words; `recap` stride-samples ~4 lines across the whole context; `who` uses `extractCharacters`; `scene` returns the last 3 lines.
  Bedrock provider: prompt caching (Converse `cachePoint` on the system prompt) on by default for Anthropic models, toggle via `BEDROCK_PROMPT_CACHE=true|false`. Optional Guardrails via `BEDROCK_GUARDRAIL_ID`/`BEDROCK_GUARDRAIL_VERSION` — an intervening guardrail returns the safe fallback answer with `'bedrock-guardrail'` in `guard.flags`.
  Observability: one CloudWatch Embedded Metric Format JSON line logged per ask (`Namespace: ContextCue`, dimensions `Provider`/`Mode`, metrics `LatencyMs`/`GuardFlags`).
- Session store: in-memory locally, DynamoDB (TTL 12h) when `SESSIONS_TABLE` set.
- Subtitles loaded server-side from `/content` (or S3 `CONTENT_BUCKET`). Clients NEVER receive future subtitle text from this API.

## Fire TV app (`apps/firetv-android`)
- Kotlin, minSdk 25 (Fire OS 7+), targetSdk 34, Compose for TV (`androidx.tv:tv-material`) + Media3 ExoPlayer. Leanback launcher intent + banner.
- Screens: Home (title rows) → Player. On Player: pause (or press Menu/☰ / long-press center) opens the **Ask panel** (right-side sheet, video dims but stays visible):
  chips: "Catch me up", "Who's who so far", "What just happened?", "Why did they do that?", + "Ask on your phone" (QR + session code).
- Answers: overlay card with answer + tappable timestamp citations (select → seek back to replay that line). "Spoiler-safe until 12:04" badge always shown.
- Heartbeat: PUT session position every 2s while playing. Optional TTS via /v1/speak (Polly) toggled with a "Read aloud" chip.
- "Welcome back" recap: if paused > 5 min or app resumed, offer one-press recap.
- D-pad fully navigable, visible focus states, 10-foot typography (min 24sp body), safe-area margins (48dp/27dp).
- API base URL from BuildConfig (default `http://10.0.2.2:8787` for emulator), overridable in a settings screen.

## Companion (`apps/companion`)
- Phone web app: enter/scan session code → shows "Now watching X at 12:04 (spoiler-safe)"; text + voice (Web Speech API) question; answers + citations. Mobile-first, dark theme.

## Quality bar (judges read the code)
- Unit tests for every core invariant (esp. NO cue after T ever in context/prompt — property test with random positions).
- `npm test` at root passes. `npm run dev` starts api (mock) + companion. README quickstart works from clean clone.
- No secrets in repo. MIT LICENSE at root and in packages/core.
