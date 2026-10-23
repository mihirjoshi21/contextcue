# @contextcue/api

Hono app that answers spoiler-safe questions about whatever's playing, grounded only in
dialogue that has already aired. Runs identically as a local Node server and as an AWS Lambda
(same `src/app.ts` factory both ways), and exposes an MCP (Model Context Protocol) server at
`/mcp` so Alexa+ (or any MCP client) can ask the same questions.

## Quickstart (offline, no AWS needed)

```bash
npm install            # from the repo root (npm workspaces)
npm run dev -w @contextcue/api
# -> http://localhost:8787
```

`PROVIDER` defaults to `mock`, so the whole thing works with zero AWS credentials: a
deterministic, extractive "AI" answers from the retrieved subtitle cues. Content is loaded from
`/content/titles.json` (repo root) by default — see `CONTENT_DIR`/`CONTENT_BUCKET` below.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | `tsx watch src/local.ts` — local server on `PORT` (default 8787), hot reload |
| `npm run build` | esbuild-bundles `src/lambda.ts` → `dist/lambda.mjs` for Lambda deploy |
| `npm test` | `vitest run` |
| `npm start` | runs the built `dist/lambda.mjs` handler directly (mostly for smoke-testing the bundle) |
| `npm run typecheck` | `tsc --noEmit` |

## Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `8787` | local server only |
| `PROVIDER` | `mock` | `mock` \| `bedrock` |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Converse API model/inference-profile id |
| `AWS_REGION` | `us-east-1` | set automatically by the Lambda runtime; set manually for local Bedrock/Polly testing |
| `CONTENT_DIR` | `<repo>/content` | local filesystem content source |
| `CONTENT_BUCKET` | _(unset)_ | if set, content loads from this S3 bucket instead of the filesystem |
| `SESSIONS_TABLE` | _(unset)_ | if set, sessions use DynamoDB instead of in-memory |
| `SPEECH` | `mock` (local) / `polly` (lambda) | `mock` \| `polly` |
| `BEDROCK_PROMPT_CACHE` | _(unset)_ | `true`/`false` to force prompt caching on/off; unset = on for Anthropic models, off otherwise |
| `BEDROCK_GUARDRAIL_ID` / `BEDROCK_GUARDRAIL_VERSION` | _(unset)_ | if both set, Bedrock calls pass `guardrailConfig`; see "Bedrock upgrades" below |

## Endpoints (see `/SPEC.md` at repo root for the full contract)

```bash
# Health
curl localhost:8787/health
# {"ok":true,"provider":"mock"}

# List titles (playbackStartMs/skipRanges present only if set in titles.json)
curl localhost:8787/v1/titles

# Ask a spoiler-free question
curl -X POST localhost:8787/v1/ask \
  -H 'content-type: application/json' \
  -d '{"titleId":"demo-1","positionMs":20000,"question":"What just happened?"}'
# { "answer": "...", "mode": "ask", "citations": [...], "safeUntilMs": 20000,
#   "guard": { "passed": true, "flags": [] }, "provider": "mock", "model": "...", "latencyMs": 3 }

# A non-"ask" mode doesn't need a question — a default is used per mode.
curl -X POST localhost:8787/v1/ask \
  -H 'content-type: application/json' \
  -d '{"titleId":"demo-1","positionMs":20000,"mode":"recap"}'

# Streaming variant (SSE): sentence-by-sentence, each already past the
# spoiler guard, then a final `done` event with the full response shape.
curl -N -X POST localhost:8787/v1/ask/stream \
  -H 'content-type: application/json' \
  -d '{"titleId":"demo-1","positionMs":20000,"question":"What just happened?"}'
# event: sentence
# data: {"type":"sentence","text":"..."}
#
# event: done
# data: {"type":"done","answer":"...","mode":"ask","citations":[...],...}

# Create a session (TV starts one, companion phone joins with the code)
curl -X POST localhost:8787/v1/sessions
# {"code":"AB23CD"}

# TV heartbeats its position (every ~2s while playing)
curl -X PUT localhost:8787/v1/sessions/AB23CD \
  -H 'content-type: application/json' \
  -d '{"titleId":"demo-1","positionMs":42000,"playing":true}'

curl localhost:8787/v1/sessions/AB23CD

# Ask via a session — server clamps to min(client, session) position, so a
# companion can never ask further than the TV has actually played. An unknown
# sessionCode is a 404 (never a silent fallback to the client's own position).
curl -X POST localhost:8787/v1/ask \
  -H 'content-type: application/json' \
  -d '{"titleId":"demo-1","positionMs":999999,"question":"Catch me up","mode":"recap","sessionCode":"AB23CD"}'

# "Show on TV": a companion's answer, pushed onto the session for the TV app
# to display — GET/PUT /v1/sessions/:code then include `sharedAnswer`.
curl -X POST localhost:8787/v1/ask \
  -H 'content-type: application/json' \
  -d '{"titleId":"demo-1","positionMs":20000,"question":"Who is that?","sessionCode":"AB23CD","showOnTv":true}'
curl localhost:8787/v1/sessions/AB23CD
# { "code": "AB23CD", ..., "sharedAnswer": { "id": "...", "question": "Who is that?", "answer": "...", "citations": [...], "mode": "ask", "createdAt": 1234567890 } }

# Who's who so far (optional sessionCode clamps positionMs the same way as /v1/ask)
curl 'localhost:8787/v1/titles/demo-1/characters?positionMs=20000'

# Spoken answer (Polly neural; mock returns an empty payload + error flag offline)
curl -X POST localhost:8787/v1/speak \
  -H 'content-type: application/json' \
  -d '{"text":"Hello there."}'
```

## MCP (Alexa+ / any MCP client)

Mounted at `/mcp` using the official `@modelcontextprotocol/sdk`'s
`WebStandardStreamableHTTPServerTransport` (Streamable HTTP, protocol version
`2025-11-25` — confirmed via `LATEST_PROTOCOL_VERSION` in the installed SDK). Stateless: a
fresh `McpServer` + transport is created per request, so it works unmodified on Lambda (no
session affinity needed).

Tools: `get_now_playing(sessionCode)`, `ask_spoiler_free(sessionCode, question)`,
`catch_me_up(sessionCode, minutes?)`, `who_is(sessionCode, description)`. All four require a
session code (from the TV/companion) — there's no client-supplied position for a voice
assistant, so the session is the only source of truth for "how far has this viewer watched".

See `test/mcp.test.ts` for a full roundtrip using the SDK's own `Client` +
`StreamableHTTPClientTransport` against a locally started server.

## Request validation (`/v1/ask`, `/v1/ask/stream`, `/v1/titles/:id/characters`)

- `question` is required only for `mode: 'ask'` (the default mode); other modes fall back to a
  canned default question — a TV remote chip like "Catch me up" has no text input. Over 500 chars
  is a 400.
- `positionMs` must be a non-negative finite number (400 otherwise) — it's clamped to the title's
  `durationMs`, never rejected for being past the end.
- An unresolvable `sessionCode` is a **404**, never a silent fallback to the client's own claimed
  position — see `test/ask-validation.test.ts`.
- `/v1/titles/:id/characters` accepts the same optional `sessionCode` and clamps `positionMs` to
  it the same way `/v1/ask` does.

## "Show on TV" (`showOnTv` + `sharedAnswer`)

`POST /v1/ask` / `/v1/ask/stream` accept `showOnTv?: boolean` alongside `sessionCode`. When both
are present, the answer is written onto the session as
`sharedAnswer: { id, question, answer, citations, mode, createdAt }` — both `InMemorySessionStore`
and `DynamoSessionStore` support this (the Dynamo store does a read-modify-write full-item `Put`,
so a new `SessionState` field never needs a matching hand-written `UpdateExpression`). Any
subsequent `GET`/`PUT /v1/sessions/:code` includes `sharedAnswer` in the response, so a Fire TV
app polling/re-fetching the session can display "the companion asked X, here's the answer" on the
big screen. See `test/show-on-tv.test.ts` and `test/session-dynamo.test.ts`.

## Spoiler safety (two layers, both exercised in `test/`)

1. **Hard ceiling**: `@contextcue/core`'s `buildContext`/`cuesUpTo` only ever include cues with
   `startMs <= positionMs`. The session min-rule (`test/ask.test.ts`) additionally clamps a
   companion's claimed position to the TV's actual position.
2. **Leak guard**: every provider's raw output — mock or Bedrock — is run through
   `core.spoilerGuard` before it's returned. Citations (`src/citations.ts`) are derived
   independently and have their own hard safety net: a citation with `startMs` past the safe
   position is never returned, even if the model or guard somehow let a future timestamp through.

## Providers

- **`MockProvider`** (`src/providers/mock.ts`): fully deterministic, offline, and **mode-aware** —
  it's an honest stand-in, not a fake "AI":
  - `ask`: picks the cues whose words best overlap the question (falls back to the most recent
    cues if nothing overlaps).
  - `recap`: prefaces with `"Offline demo mode — key lines so far:"` and stride-samples ~4 lines
    evenly across the whole context, so a recap actually spans the story instead of just the tail.
  - `who`: runs `core.extractCharacters` over the context's cues and lists names with when they
    were first heard.
  - `scene`: the last 3 lines.

  Used by default and by all tests that don't specifically target Bedrock.
- **`BedrockProvider`** (`src/providers/bedrock.ts`): Converse API, `system`/`user` from
  `core.buildPrompt`, `temperature: 0.2`. Throttling/errors degrade to a clean fallback message
  with `error: true` rather than a 500. Tested against a mocked `BedrockRuntimeClient`
  (`aws-sdk-client-mock`) in `test/bedrock.test.ts` — never exercised against the real Bedrock
  API in this repo (no credentials in this environment).

### Bedrock upgrades

- **Prompt caching**: a Converse `cachePoint` block is appended after the system prompt (the
  spoiler-safety rules, which never change per-request — the transcript/question live in `user`
  per SPEC.md, so only `system` is cached). On by default for Anthropic model ids; toggle with
  `BEDROCK_PROMPT_CACHE=true|false`.
- **Guardrails**: set both `BEDROCK_GUARDRAIL_ID` and `BEDROCK_GUARDRAIL_VERSION` to pass
  `guardrailConfig` on every Converse/ConverseStream call. If the guardrail intervenes
  (`stopReason: 'guardrail_intervened'`), the response is `core.SPOILER_SAFE_FALLBACK` with
  `'bedrock-guardrail'` added to `guard.flags` — never the model's blocked output. `infra/` can
  provision a real kids-mode content-filter guardrail; see `infra/README.md`.
- **Streaming**: `askStream` uses `ConverseStreamCommand`, yielding raw text deltas. The shared
  pipeline in `src/ask.ts` (`answerQuestionStream`) buffers deltas into complete sentences and
  runs `spoilerGuard` on each one before ever emitting it as an SSE `sentence` event — a flagged
  sentence is dropped, not sent-then-retracted. `MockProvider.askStream` streams its own answer
  the same way (split into sentence-sized chunks), so `/v1/ask/stream` works fully offline too.
- **Observability**: one CloudWatch Embedded Metric Format JSON line per ask
  (`console.log`, no extra dependency) — `Namespace: ContextCue`, dimensioned by `Provider`/`Mode`,
  metrics `LatencyMs` and `GuardFlags`. CloudWatch Logs auto-extracts these as metrics from
  Lambda's stdout.

## What isn't tested here

- Real Bedrock / Polly / DynamoDB / S3 — everything AWS-backed is exercised only against mocked
  clients (`aws-sdk-client-mock`) or the in-memory/filesystem equivalents. `cdk synth` (in
  `/infra`) verifies the deployment shape compiles, not that it actually deploys.
- The companion static-file serving in `local.ts` (`/companion`) — only smoke-tested manually, no automated test serves real companion build output.
