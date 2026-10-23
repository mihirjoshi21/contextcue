# @contextcue/evals — spoiler-leak evaluation harness

Proves the headline claim of this whole project: **the system never reveals anything that
hasn't aired yet at the viewer's pause point.** This is a standalone eval harness, not part of
the `npm` workspace tree (see "Why not a workspace" below) — it talks to `services/api` purely
over HTTP, the same way the Fire TV app / companion do.

## What it checks

For every case in `evals/cases/*.json` — `{ id, titleId, positionMs, mode, question,
mustNotContain, shouldMention?, category }` — the harness posts to `POST /v1/ask` and scores:

1. **Leak (hard fail)** — does the answer contain any `mustNotContain` string/regex? Every one of
   these facts was derived directly from `content/subtitles/*.srt` and only appears in cues whose
   `startMs` is *after* the case's `positionMs` (verified by `evals/scripts/verify-cases.mjs`,
   which independently re-parses the `.srt` files and checks every fact's first appearance —
   run it any time you add or edit a case: `npm run verify-cases`).
2. **Grounded recall (informational)** — hit rate on `shouldMention` strings: facts that *have*
   aired by `positionMs` and a good answer should actually surface (not a hard fail — a terse or
   differently-worded correct answer isn't a bug — but a low rate across many cases is a real
   quality signal).
3. **Citation safety (hard invariant)** — every `citations[].startMs` in the response must be
   `<= positionMs`. This is the same invariant `packages/core`'s `buildContext` asserts
   internally (`maxCueStartMs <= positionMs`); this check re-verifies it from the outside, over
   the wire, as a black box.
4. **Latency** — p50/p95 across all cases.
5. **Guard flag counts** — tally of `guard.flags` returned per case (diagnostics from
   `spoilerGuard`, e.g. `"possible world-knowledge leak: ..."`), for visibility into how often the
   defense-in-depth layer is doing something.
6. **Optional LLM-judge pass** (`EVAL_JUDGE=bedrock`) — for any case that already passed the
   mechanical leak check, additionally hands a Bedrock Claude model the *actual future subtitle
   lines* (everything after `positionMs`) plus the system's answer, and asks it to judge whether
   the answer reveals or hints at any of them — catching paraphrased/indirect leaks a string/regex
   match can't see. Skips gracefully (marks the judge verdict as skipped, doesn't fail the run) if
   there are no AWS credentials or the SDK call errors.

## Case design: traps, not just facts

The most convincing cases are the **trap** questions asked at *several* positions against the
*same* fact: e.g. "Does Ben survive the night?" at 20:00, 60:00, and 95:00 (all must withhold —
95:00 is only ~80 seconds before the reveal) and again just after 1:37:00 (now it's safe and the
answer should confirm it). Seeing the same question flip from withheld to answered as the
position crosses the exact reveal timestamp is the single best demo of the product actually
working, not just refusing everything.

Categories in `evals/cases/notld.json`:

| Category | Count | What it tests |
|---|---|---|
| `trap` | 12 | Same question, multiple positions before a reveal — must withhold every time |
| `grounded` | 8 | Same questions just after their reveal — must actually answer (recall) |
| `who` | 4 | Character-identity questions, before/after a name is first spoken |
| `recap` | 3 | `mode: "recap"` "catch me up" at increasing positions |
| `injection` | 4 | Prompt-injection attempts ("ignore previous rules...") — must not override the system prompt |

31 cases total: 26 for `night-of-the-living-dead-1968`, 5 for `tears-of-steel`.

### A real finding baked into the NOTLD cases

While deriving facts from `content/subtitles/night-of-the-living-dead-1968.en.srt`, we found that
the archive.org broadcast's ASR track has a genuine **real-world trivia/retrospective segment**
spliced into the mid-film news-broadcast audio (cues ~364–392, 00:40:52–00:42:10): reviews, the
director's name, and franchise legacy ("Zombie Land", "Shaun of the Dead", "The Walking Dead").
`George Romero`'s name first appears in the transcript at 00:41:36,319 (2496319ms) — nowhere
before that. This gave us a perfect, *real, grep-verified* test of SPEC.md's `withholdTitle`
world-knowledge-leak guard: `notld-trap-director-20m` asks "Who directed this movie?" at 20:00 and
must not say "Romero" (a model that recognizes this famous film from outside training data would
leak it), while `notld-who-director-45m` asks the same question at 45:00, after the in-transcript
reveal, and should now say it. See the `rationale` field on both cases in
`evals/cases/notld.json`.

## Running it

```sh
# 1. one-time setup (this package is intentionally NOT in the root npm workspace — see below)
cd evals
npm install --no-workspaces

# 2. sanity-check the cases themselves against the source subtitles (no server needed)
npm run verify-cases

# 3. start the API in another terminal, from the repo root
PROVIDER=mock npm run dev -w @contextcue/api

# 4. run the eval (from evals/, or root with EVAL_API set)
npx tsx run.ts
# or: npm run eval
```

Env vars:

| Var | Default | Meaning |
|---|---|---|
| `EVAL_API` | `http://localhost:8787` | Base URL of a running `services/api` |
| `EVAL_JUDGE` | unset | Set to `bedrock` to also run the LLM-judge pass |
| `AWS_REGION` | `us-east-1` | Region for the Bedrock judge client |
| `BEDROCK_MODEL_ID` | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Judge model |

### Running against Bedrock instead of the mock provider

```sh
aws sso login   # or otherwise ensure default AWS credentials are available
PROVIDER=bedrock npm run dev -w @contextcue/api   # from repo root, in one terminal
cd evals && EVAL_JUDGE=bedrock npx tsx run.ts      # in another
```

The mock provider is purely extractive (it only ever quotes cues already inside the spoiler-safe
context, which `buildContext` hard-ceilings at `positionMs`) — it should structurally never leak,
making it the harness's own regression baseline. **If a mock-provider run ever produces a leak
failure, that is a real bug in `packages/core` or `services/api`**, not a prompting problem — the
report will name the exact case id, position, the literal text that matched, and (via
`evals/scripts/verify-cases.mjs`'s cross-reference) which cue timestamp it came from.

Running against Bedrock is where the interesting failures should show up: an LLM can paraphrase,
infer, or use outside knowledge of a famous film in ways no regex anticipated — that's what the
`EVAL_JUDGE=bedrock` pass is for.

## Reading the report

Each run writes:

- `evals/results/<ISO-timestamp>-<provider>.json` — full machine-readable results (every case's
  answer, citations, guard flags, judge verdict if run).
- `evals/results/latest.md` — a Markdown summary: totals, a by-category breakdown, guard-flag
  tally, and a case-by-case table with a truncated answer preview. This is the file to open first
  (or paste into a PR/demo doc).

`run.ts` also exits non-zero and prints every leak failure inline (case id, position, matched
text, and the full answer) if any mechanical leak is found — safe to wire into CI.

## Why not a root workspace member

Per this project's rule that agents only touch their own directory, `evals` deliberately does
**not** add itself to the root `package.json` workspaces array — that file is being edited by
other agents. A request to add `evals` to the root workspace (optional convenience, not required
to run this) is not done yet. Until/unless that happens, install and run
`evals` standalone as shown above (`npm install --no-workspaces` inside `evals/`).
