# Architecture

Deeper companion to the [root README](../README.md)'s architecture diagram. Covers: the request
lifecycle of a single "ask", the spoiler invariant and how it's proven, retrieval strategy, prompt
design, the leak guard, the MCP surface, security posture, latency budget, and a cost estimate.

## Request lifecycle of an "ask"

```mermaid
sequenceDiagram
    participant TV as Fire TV app
    participant Phone as Phone companion
    participant API as services/api (Hono)
    participant Core as @contextcue/core
    participant Bedrock as Bedrock (Claude, Converse)
    participant Ddb as DynamoDB (sessions)

    Note over TV,Ddb: TV heartbeats its own position every ~2s while playing
    TV->>API: PUT /v1/sessions/:code { titleId, positionMs, playing }
    API->>Ddb: write session state (TTL 12h)

    Phone->>API: POST /v1/ask { titleId, positionMs: (phone's guess), question, sessionCode }
    API->>Ddb: read session state for :code
    API->>API: safeMs = min(phone's positionMs, session's positionMs)
    Note right of API: a companion can never ask further<br/>than the TV has actually played

    API->>Core: buildContext(cues, safeMs, question)
    Note right of Core: cuesUpTo() hard ceiling:<br/>only startMs <= safeMs ever leaves this call
    Core-->>API: SpoilerSafeContext (recent window + BM25/coverage retrieval)

    API->>Core: buildPrompt({ mode, question, context, withholdTitle: true })
    Note right of Core: title withheld; transcript wrapped in<br/>&lt;transcript&gt; tags; asserts no future cue again
    Core-->>API: { system, user, maxTokens }

    API->>Bedrock: Converse({ system, messages: [user], temperature: 0.2 })
    Bedrock-->>API: raw answer text

    API->>Core: spoilerGuard(answer, context)
    Note right of Core: strips future-tense phrasing,<br/>future timestamps, ungrounded proper nouns
    Core-->>API: { passed, flags, sanitized }

    API->>API: buildCitations() — independent hard-ceiling filter,<br/>maps cited [mm:ss] to nearest PAST cue only
    API-->>Phone: { answer: sanitized, citations, safeUntilMs: safeMs, guard, provider, model, latencyMs }
```

The same lifecycle runs for the Fire TV app's own Ask panel (it calls `/v1/ask` directly with its
own `positionMs`, no `sessionCode` clamping needed since it *is* the position source of truth) and
for MCP tool calls (`ask_spoiler_free` etc.), which always go through a session code since a voice
assistant has no independent notion of "how far has this viewer watched."

## The spoiler invariant, and how it's proven

> **No cue with `startMs > positionMs` ever appears in any context object or any prompt string
> produced by `@contextcue/core`.**

This is asserted, not just documented:

- `assertNoFutureCues` (`packages/core/src/invariant.ts`) throws (not logs) if violated, called
  independently in two places: at the end of `buildContext`, and again in `buildPrompt` over the
  literal cues about to be rendered into prompt text — so a bug in how a `SpoilerSafeContext` was
  constructed elsewhere can't silently bypass the check.
- **Property-tested** with `fast-check` (`packages/core/test/context.property.test.ts`, 300 runs):
  random subtitle sets and random playback positions are fed through `cuesUpTo`, `buildContext`,
  and `buildPrompt`, checking not just that timestamps compare correctly but that the *rendered
  prompt text itself* never contains a verbatim fragment from a future cue.
- **A second, independent safety net for citations** (`services/api/src/citations.ts`): even if a
  hypothetical bug in the guard or a citation source somehow contained a future cue, `buildCitations`
  filters its candidate pool to `startMs <= safeMs` before *and* after processing, and is unit
  tested against a fixture with a deliberately "leaked" future cue planted in the candidate pool,
  independent of whether `spoilerGuard` would have caught it (`services/api/test/citations.test.ts`).
- **The session min-rule** (`services/api/src/ask.ts`, tested in `test/ask.test.ts`) clamps a
  companion's claimed position to `min(client, session)`, so the invariant holds even when the
  client can't be trusted to report its position honestly.

## Retrieval strategy

`buildContext(cues, positionMs, question, opts)` — full details in
[`packages/core/README.md`](../packages/core/README.md#windowing--retrieval):

- If the *entire* past transcript fits inside the character budget (`maxChars`, default 60,000 ≈
  15k tokens), it's all included (`full: true`) and retrieval is skipped.
- Otherwise the last `recentWindowMs` (default 3 minutes) is always included verbatim, and the rest
  of the budget is spent per `strategy`:
  - **`'auto'` (default)** — BM25 (k1=1.2, b=0.75, English stopwords stripped, no stemming) against
    the question when it's non-empty, each hit expanded with its ±1 neighbor cue, *plus* any leftover
    budget always spent on evenly stride-sampled coverage of the rest of the older transcript. This
    matters concretely for `recap`/`who`/`scene`, which typically call `buildContext` with an empty
    question — without the coverage top-up, a "catch me up" 90 minutes into a film would silently
    degrade to just the last 3 minutes of dialogue.
  - **`'retrieval'`** — pure BM25 relevance, no coverage top-up (explicit opt-in for a narrowly
    targeted `ask`).
  - **`'coverage'`** — ignore the question, always stride-sample the whole past.
- Context budget allocation is "recent window first, then whole neighbor-groups that fit" — a BM25
  hit's ±1-neighbor triplet is included only if the *whole* group fits in what's left; a group is
  never partially truncated (a hit can be dropped entirely under a tight budget rather than handing
  the model an orphaned neighbor cue).
- **Known weakness**: no stemming, so "disappear"/"disappeared" are different BM25 tokens. Works in
  practice because subtitle dialogue repeats key nouns (character/place names) far more than verb
  forms — flagged as a known limitation, not silently glossed over.

## Prompt design

`buildPrompt({ mode, question, context, titleHint, withholdTitle, audience, locale })` renders a
`system` + `user` string pair, capped at a small `maxTokens` per mode (`ask`: 220, `recap`: 350,
`who`: 260, `scene`: 240) — deliberately short, spoken-friendly answers, not essays.

- **Title withholding is the primary anti-leak lever, not the transcript ceiling.** The single
  biggest spoiler-leak vector isn't missing data, it's the model's own world knowledge: told "this
  is *The Sixth Sense*, question: is Malcolm alive?", a frontier model's pretraining knowledge
  activates and no "only use the transcript" instruction reliably overrides it. `withholdTitle: true`
  (the default) means the model only ever sees anonymous dialogue, with nothing to pattern-match a
  famous story against.
- The system prompt additionally instructs: answer only from the supplied transcript; act as though
  you've never encountered this story before even if you privately recognize it; never speculate
  about what's coming; say "that hasn't been revealed yet" rather than guess; cite timestamps in
  `[mm:ss]` format; keep to ≤3 short sentences (≤5 for recap).
- **Prompt-injection hardening**: subtitle text (and the viewer's question) is untrusted — a crafted
  cue could contain something that reads as an instruction. The rendered transcript is wrapped in
  `<transcript>…</transcript>`, the question in `<question>…</question>`, the system prompt states
  plainly that content inside those tags is data, never instructions, and any literal
  `</transcript>`/`</question>` in the source text is stripped before embedding — so injected text
  can never forge a fake tag close and "escape" into what looks like a fresh instruction.

## The guard (`spoilerGuard`)

Defense-in-depth for when prompt-level instructions aren't enough (models don't always follow
instructions). Per sentence, flags:

- **Future-tense/spoiler-signaling phrases** — "will later", "eventually", "turns out", "in the
  end", "spoiler", etc.
- **Timestamps cited past the current playhead** (`positionMs`).
- **Proper nouns not present anywhere in the context text actually shown to the model** — a
  case-insensitive, word-boundary substring check against the concatenated context cue text (not
  document-frequency or NER-based) — a tell for the model reaching into outside knowledge. Every
  capitalized token is checked regardless of sentence position, exempted only by a fairly broad
  allowlist of common capitalized discourse words ("The", "He", "However", "Earlier", ...) or by
  being immediately preceded by an opening quote/bracket (to avoid flagging a quoted aside or
  bracketed stage direction).

`guard.sanitized` is the answer with offending sentences removed; if nothing is left, a fixed safe
fallback string (`SPOILER_SAFE_FALLBACK`) is substituted. `guard.passed === false` surfaces to the
UI as a subtle "N possible spoiler(s) removed" line rather than silently rewriting the answer with
no indication anything changed.

## Streaming (`POST /v1/ask/stream`)

An SSE variant of `/v1/ask` for a faster perceived response on longer answers (recaps especially).
The shared pipeline (`answerQuestionStream` in `services/api/src/ask.ts` — one implementation used
by both the Bedrock and Mock providers, not a per-provider reimplementation) buffers raw model
output into complete sentences (`src/sentences.ts`) and runs `spoilerGuard` on **each completed
sentence before it is ever emitted** as an `event: sentence` frame — a flagged sentence is dropped
silently, never sent then retracted. A final `event: done` frame carries the same response shape as
non-streaming `/v1/ask`. `POST /v1/ask` itself is unchanged. One known coarseness, called out
honestly: a sentence guarded in isolation lacks the surrounding sentences' context, though since the
guard's checks (future-tense phrases, unrecognized proper nouns, future timestamps) are all
self-contained per-sentence, this hasn't shown any behavioral difference in testing.

## Bedrock prompt caching — an honest description

`BedrockProvider` appends a Converse `cachePoint: { type: 'default' }` block after the **system**
prompt (on by default for Anthropic model ids; toggle with `BEDROCK_PROMPT_CACHE=true|false`). Only
`system` is cached — the fixed spoiler-safety rules, which never change per request — because the
transcript and question (which do change every request) live in `user`, per `core.buildPrompt`'s
design.

**Measured against live Bedrock:** the system prompt alone is below the minimum cacheable length, so the provider also places a `cachePoint` after the transcript (it splits the user message at the `<question>` block). Live usage logs show cache writes of 6–18k tokens on a first question and cache reads of 10–13k tokens on a follow-up at the same pause, so repeated questions while paused reuse the transcript. Questions at a new position write a new cache entry, which costs slightly more than an uncached call. The code path
exists and is correct to call; the *benefit* is the part that needs a live check.

## Optional Bedrock Guardrails

Set both `BEDROCK_GUARDRAIL_ID` and `BEDROCK_GUARDRAIL_VERSION` (or deploy with
`-c withGuardrail=true`, which provisions an `AWS::Bedrock::Guardrail` with five content-filter
categories at `HIGH` strength for a "kids mode" audience) to pass `guardrailConfig` on every
Converse/ConverseStream call. If the guardrail intervenes (`stopReason: 'guardrail_intervened'`),
the response is `core.SPOILER_SAFE_FALLBACK` — the exact same fallback string the spoiler guard
itself uses — with `'bedrock-guardrail'` added to `guard.flags`, never the model's raw blocked
output. Off by default (a standing Guardrail resource isn't needed for the base demo path).
**Never exercised against a live Guardrail** — verified only that `cdk synth` succeeds both with
and without the flag, and that `guardrailConfig` is passed correctly to a mocked
`BedrockRuntimeClient`. The guardrail is optional and not deployed in the demo stack, so its behavior against live content hasn't been measured.

## Observability (CloudWatch EMF)

One CloudWatch Embedded Metric Format JSON line is logged per ask via plain `console.log` (no new
dependency) — `Namespace: ContextCue`, dimensioned by `Provider`/`Mode`, metrics `LatencyMs` and
`GuardFlags`. CloudWatch Logs auto-extracts these into real CloudWatch metrics from Lambda's stdout,
so no separate metrics SDK call is needed. Left unconditional (it also emits during `npm test`, into
vitest's captured stdout) rather than gated behind an environment check — simplicity over tidiness,
and it doesn't fail or measurably slow down tests. The deployed Lambda emits these lines (they now also carry input/output and cache read/write token counts); the EMF JSON shape was checked against AWS's documented format.

## API Gateway throttling

The HTTP API's default stage is throttled at the CloudFormation level (`RouteSettings`) — 20
requests/second sustained, 40 burst by default, overridable via `-c throttleRateLimit=N -c
throttleBurstLimit=N`. This is a coarse, global backstop against a runaway client or misbehaving demo
script, not per-client/per-IP protection. A real `AWS::WAFv2::WebACL` `RateBasedStatement` (per-IP,
5-minute-window granularity) is documented — exact CDK snippet included — in `infra/README.md` as an
optional next step, deliberately not provisioned (a standing WebACL is a real ongoing cost a
hackathon demo audience doesn't need).

## MCP tools (Alexa+ / any MCP client, mounted at `/mcp`)

Protocol version `2025-11-25`, Streamable HTTP, stateless (fresh `McpServer` + transport per
request — no session affinity needed, so it runs unmodified on Lambda regardless of which warm
instance handles a given request). All four tools require a `sessionCode` — there is no
client-supplied position for a voice assistant, so the session (written by the TV's heartbeat) is
the only source of truth for "how far has this viewer watched":

| Tool | Purpose |
| --- | --- |
| `get_now_playing(sessionCode)` | What title and position is this session currently at |
| `ask_spoiler_free(sessionCode, question)` | Free-form question, same spoiler-safety pipeline as `/v1/ask` |
| `catch_me_up(sessionCode, minutes?)` | Recap mode |
| `who_is(sessionCode, description)` | Resolve "who's the guy in the jacket" style questions against characters seen so far |

## Security

- **No future subtitle text ever leaves the server.** Clients (Fire TV app, companion, MCP client)
  never receive raw subtitle content past the requester's clamped position — only the model's
  already-guarded answer text and citations, which have their own independent past-only filter
  (see the invariant section above). The subtitle files themselves are never served as a static
  asset the client could read directly; they're loaded server-side (filesystem or S3) and only
  ever appear inside a prompt string that itself never leaves the Lambda.
- **Session min-rule** (see above) prevents a companion device from simply claiming a later
  position than the TV has actually reached — but that rule is only as trustworthy as the session
  state it reads, which is why session *writes* are separately authenticated (next point).
- **Session write authentication (`tvToken`)** — added in a dedicated security-review round after an
  adversarial pass found session writes were completely unauthenticated: anyone who could see/guess
  a 6-character join code could rewrite its `titleId`/`positionMs`/`playing` via `PUT`, which is also
  the *only* input the position-clamping above trusts — an attacker who could `PUT` could push a
  session's `positionMs` forward and make `/v1/ask` leak arbitrary future content through that
  session code. Fixed with a second, separate secret: `POST /v1/sessions` returns `{code, tvToken}` —
  `tvToken` is 24 random bytes as URL-safe base64, returned in plaintext **exactly once** and never
  again. The session stores only `sha256(tvToken)`, compared with `crypto.timingSafeEqual` (never a
  plaintext secret at rest, never a non-constant-time comparison). `PUT /v1/sessions/:code` 403s
  without a matching `X-TV-Token` header, checked before the body is even parsed. The join `code`
  deliberately stays unauthenticated for `GET`/`POST /v1/ask` (read/append-only by design — asking
  questions or pushing a `showOnTv` answer was never the privileged operation; changing what the TV
  is playing, or where, is). `toPublicSession()` strips the token hash from every response body.
- **CRITICAL fix: title/session mismatch on `/v1/titles/:id/characters`.** The same security review
  found that when a `sessionCode` was given, the endpoint clamped `positionMs` to the session but
  still answered for whatever `:id` the URL asked for — so a client could ask about a *different*
  title than the session is actually watching, at whatever position it wanted for that other title,
  entirely bypassing the clamp's reason for existing. Fixed: the session's `titleId` now always wins
  — if the session has no `titleId` yet, returns `[]`; if it differs from the URL's `:id`, **409**
  `{error: 'title does not match session'}`.
- **Input validation hardening**: `PUT /v1/sessions/:code` now validates `titleId` against the
  catalog (404 if unknown), `positionMs` (non-negative finite, clamped to duration), and `playing`
  (must be boolean) — previously none of these were checked, so a bad value could silently corrupt
  session state that the spoiler-safety clamp then trusted.
- **`locale` validated at two independent layers** — a plausible prompt-injection vector, since it
  flows into the Bedrock system prompt. The HTTP boundary (`services/api/src/ask.ts`) 400s on a
  `locale` that fails `/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/`; `packages/core`'s `buildPrompt`
  itself *defensively re-checks the same regex and silently drops* (not throws on) an invalid
  `locale` — since `buildPrompt` is a public library function any other consumer could call directly
  with unvalidated input, the API-layer check alone wasn't real defense-in-depth.
- **`skipRanges` enforced, not just documented**: cues inside a title's non-story broadcast-host
  segments are filtered out before `buildContext`, `extractCharacters`, or any MCP tool ever sees
  them — a cue inside a skip range is treated exactly like a future cue: it was never actually
  watched, so it's never surfaced.
- **Poster filenames** (`GET /v1/posters/:file`) are checked against an allow-list regex
  (`^[A-Za-z0-9][A-Za-z0-9_-]*\.(jpg|jpeg|png|webp)$`) before reaching either content store — no
  `..`, no absolute path, no nested traversal can match.
- **API Gateway throttling** (see above) as a coarse abuse backstop.
- **Prompt-injection handling** for the transcript/question themselves: see "Prompt design" above —
  both are tagged and de-fanged before being embedded in the prompt.
- **MCP transport security**: per the 2025-11-25 spec, `Origin` header validation and
  `MCP-Protocol-Version` header checks are the server's job to prevent DNS-rebinding-style attacks;
  this repo's MCP mount runs statelessly behind API Gateway (TLS terminated at the edge). **Not
  implemented**: full OAuth 2.1 + PKCE account-linking for a certified Alexa+ add-on (Amazon's Alexa+
  MCP Toolkit requires this for production certification) — the hackathon rules explicitly accept a
  "simulated Alexa+ experience," which is what this MCP surface is scoped as. See
  the Amazon developer docs for the full requirement list if real account-linking is
  attempted later.
- **No secrets committed to the repo**; AWS credentials are supplied at runtime via `aws sso login`/
  Lambda's execution role, never hardcoded.
- **What this security round did not cover**: rate limiting is IP-agnostic (global, not per-client);
  there's no WAF in front of the API by default; the `tvToken`/session model has no expiry shorter
  than the session's own 12h TTL (a leaked token is valid for the rest of that window).

## Evals: proving the invariant end-to-end, not just in unit tests

`evals/` (standalone package, HTTP black-box against a running `services/api`, deliberately not an
npm workspace member) is the outside-in complement to `packages/core`'s property tests: it posts
real `/v1/ask` requests and checks (1) no `mustNotContain` fact appears (hard leak fail), (2)
`shouldMention` facts that have aired *do* get surfaced (informational recall signal, not a hard
fail), (3) every returned citation's `startMs <= positionMs` (re-verifying the same invariant from
outside the process), and (4) latency and guard-flag counts. 31 cases (26 NOTLD, 5 Tears of Steel)
across `trap`/`grounded`/`who`/`recap`/`injection` categories; every fact is independently
re-derived from the actual `.srt` files by `evals/scripts/verify-cases.mjs`, not typed from memory.

**A real finding came out of building these cases, not just from running them**: the NOTLD
subtitle track's ASR transcription of the archive.org broadcast rip turned out to contain a genuine
mid-film splice — a retrospective segment (reviews, the director's name "George Romero", anachronistic
franchise references like "The Walking Dead") inserted into the film's own in-story radio news
bulletin, discovered by a careful linear re-read after an initial keyword-only pass missed it. This
is real content contamination distinct from the plot-spoiler problem the guard exists for — a
world-knowledge leak vector that occurs *naturally in the source data*, not just as a hypothetical.
It's now enforced via `skipRanges` (see Security) and encoded as two trap cases
(`notld-trap-director-20m`/`45m`) that assert the director's name must never appear at any playhead
position, since the film itself never names its own director once the splice is removed.

**Latest run** (`evals/results/latest.md`): Claude Haiku 4.5 on Bedrock as the system under test, Claude Sonnet 4.5 on Bedrock as the grader. 31/31 requests succeeded, **0 mechanical leak failures, 0 citation-safety violations**, 85% grounded recall, p50/p95 latency 3.3 s / 5.0 s. The grader is given both the past and the future dialogue and asked to list claims supported *only* by future lines. It flagged 4. A hand audit against the subtitle file found none revealed future events: 2 were grader errors (the lines had already played) and 2 were speaker misattributions, which a prompt change then reduced. An earlier grader version that saw only future lines produced 13 false positives, which is why it now sees both.

## Latency budget

Target: an answer should feel like a natural pause-and-ask beat, not a loading spinner.

| Stage | Approx. budget |
| --- | --- |
| Session read (DynamoDB) | low tens of ms |
| Context build (`buildContext`, in-process) | single-digit ms even for a feature-length transcript (BM25 over a few thousand cues) |
| Prompt build + guard (in-process) | single-digit ms |
| **Bedrock Converse call (Claude Haiku 4.5)** | the dominant cost — **this is why Haiku 4.5 was chosen as the default model**: short prompts (≤~15k-token context budget) and small `maxTokens` (220–350) keep this in the sub-second-to-low-single-digit-second range, per Decisions #7 |
| Polly synthesis (optional, "Read aloud") | roughly proportional to answer length; ≤3–5 sentences keeps this fast |

`POST /v1/ask/stream` (SSE, see above) exists specifically to improve *perceived* latency for longer
answers (recaps especially) — the first sentence of a guarded answer can render before the full
response finishes generating, rather than the client waiting on the entire Converse call. This
doesn't reduce total generation time, only time-to-first-visible-text.

Measured end to end against real Bedrock (Claude Haiku 4.5, 31-case eval): p50 3.3 s and p95 5.0 s per answer, with 10–18k tokens of transcript per question. Live calls to the deployed stack typically return in about 2–4 s.

## Cost estimate — Bedrock (Claude Haiku 4.5) per 1,000 questions

**This is an estimate, not a verified invoice.** It reprojects the same assumptions
`infra/README.md` uses for its hackathon-scale cost table (short prompts built from a bounded
≤60,000-character/~15k-token context budget, short answers capped at 220–350 output tokens), scaled
up from "per question" to "per 1,000 questions," using that document's own **$0.01–0.05 per
question** figure for Claude Haiku 4.5 on Bedrock Converse:

| Volume | Estimated Bedrock cost |
| --- | --- |
| 1 question | ~$0.01–0.05 |
| 1,000 questions | **~$10–$50** |

**Verify against the live [AWS Bedrock pricing page](https://aws.amazon.com/bedrock/pricing/) for
Claude Haiku 4.5 before quoting this number anywhere load-bearing** (e.g. a Devpost budget claim) —
Bedrock pricing is per-input-token/per-output-token and can change independently of this document,
and the per-question figure it's built on was itself an estimate in `infra/README.md`, not a
measured invoice (no real Bedrock calls were made in this development environment). Polly and
Transcribe costs (also estimates) are broken out separately in `infra/README.md`.

This estimate does **not** assume any benefit from prompt caching (see above) — the system prompt
may be short enough to fall below the model's minimum cacheable length, in which case real cost is
the same as shown here; if caching *does* engage in practice, real cost would be somewhat lower on
the repeated `system` portion of the input. Not measured either way.
