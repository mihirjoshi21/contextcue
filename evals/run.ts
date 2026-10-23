#!/usr/bin/env -S npx tsx
/**
 * Spoiler-leak evaluation harness for ContextCue.
 *
 * Posts every case in evals/cases/*.json to POST {EVAL_API}/v1/ask and scores:
 *   - leak:              did the answer contain any mustNotContain string/regex? (FAIL if so)
 *   - grounded recall:    hit rate on shouldMention strings/regexes (informational, not a hard fail)
 *   - citation safety:    every citations[].startMs must be <= positionMs (hard invariant from SPEC.md)
 *   - latency:            p50 / p95 across all cases
 *   - guard flags:        counts of guard.flags returned by the API (spoilerGuard diagnostics)
 *
 * Optional LLM-judge pass (EVAL_JUDGE=bedrock): for cases that pass the mechanical leak
 * check, additionally asks a Bedrock Claude judge, given the FUTURE subtitle lines (after
 * positionMs) and the answer, whether the answer reveals or hints at any of them. This
 * catches paraphrased/indirect leaks the mechanical string/regex check can't see. Skips
 * gracefully (with a note in the report) if @aws-sdk/client-bedrock-runtime has no
 * credentials or the SDK import fails.
 *
 * Writes:
 *   evals/results/<timestamp>-<provider>.json  (full machine-readable results)
 *   evals/results/latest.md                    (human-readable summary table)
 *
 * Usage:
 *   cd evals && npm install && npx tsx run.ts
 *   EVAL_API=http://localhost:8787 EVAL_JUDGE=bedrock npx tsx run.ts
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const API_BASE = process.env.EVAL_API ?? 'http://localhost:8787';
const JUDGE_MODE = process.env.EVAL_JUDGE; // e.g. 'bedrock'
const JUDGE_MODEL =
  process.env.EVAL_JUDGE_MODEL ?? 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 2));
const MAX_RETRIES = 3;

type AskMode = 'ask' | 'recap' | 'who' | 'scene';
type Category = 'trap' | 'grounded' | 'who' | 'recap' | 'injection';

interface Case {
  id: string;
  titleId: string;
  positionMs: number;
  mode: AskMode;
  question: string;
  mustNotContain?: string[];
  shouldMention?: string[];
  category: Category;
  rationale?: string;
}

interface Citation {
  startMs: number;
  endMs: number;
  text: string;
}

interface AskResponse {
  answer: string;
  mode: AskMode;
  citations: Citation[];
  safeUntilMs: number;
  guard: { passed: boolean; flags: string[] };
  provider: string;
  model: string;
  latencyMs: number;
}

interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

interface FactHit {
  entry: string;
  matched: boolean;
  matchedText?: string;
}

interface JudgeVerdict {
  leaked: boolean;
  leakedClaims: { claim: string; futureEvidence: string }[];
  reason: string;
}

interface CaseResult {
  id: string;
  titleId: string;
  positionMs: number;
  mode: AskMode;
  category: Category;
  question: string;
  ok: boolean; // request succeeded
  error?: string;
  answer?: string;
  provider?: string;
  model?: string;
  latencyMs?: number;
  leakHits: FactHit[]; // any matched === true here is a mechanical leak FAIL
  leaked: boolean;
  recallHits: FactHit[];
  recallRate: number | null; // null if no shouldMention entries
  citationsSafe: boolean;
  citationViolations: Citation[];
  guardFlags: string[];
  guardPassed: boolean | null;
  judge: JudgeVerdict | null;
}

// --- SRT parsing (self-contained; mirrors @contextcue/core's parseSrt but kept
// independent so this harness stays correct even if core changes) ---
function parseSrt(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length < 2) continue;
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;
    const m = lines[timeLineIdx].match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );
    if (!m) continue;
    const toMs = (h: string, mm: string, s: string, ms: string) =>
      ((+h * 60 + +mm) * 60 + +s) * 1000 + +ms;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const cueText = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    cues.push({ startMs, endMs, text: cueText });
  }
  return cues;
}

function toMatcher(entry: string): RegExp {
  const regexLit = entry.match(/^\/(.*)\/([a-z]*)$/);
  if (regexLit) return new RegExp(regexLit[1], regexLit[2]);
  return new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function checkFacts(answer: string, entries: string[] | undefined): FactHit[] {
  return (entries ?? []).map((entry) => {
    const re = toMatcher(entry);
    const m = re.exec(answer);
    return { entry, matched: m !== null, matchedText: m?.[0] };
  });
}

function loadCases(): Case[] {
  const casesDir = path.join(repoRoot, 'evals', 'cases');
  const files = readdirSync(casesDir).filter((f) => f.endsWith('.json'));
  const all: Case[] = [];
  for (const f of files) {
    const doc = JSON.parse(readFileSync(path.join(casesDir, f), 'utf8'));
    const cases: Case[] = doc.cases ?? doc;
    all.push(...cases);
  }
  return all;
}

function titleSubtitlePath(titleId: string): string {
  const titles = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'titles.json'), 'utf8'));
  const meta = titles.find((t: { id: string }) => t.id === titleId);
  if (!meta) throw new Error(`Unknown titleId ${titleId}`);
  return path.join(repoRoot, 'content', meta.subtitles);
}

const cuesCache = new Map<string, Cue[]>();
function cuesFor(titleId: string): Cue[] {
  if (cuesCache.has(titleId)) return cuesCache.get(titleId)!;
  const cues = parseSrt(readFileSync(titleSubtitlePath(titleId), 'utf8'));
  cuesCache.set(titleId, cues);
  return cues;
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

// --- Optional Bedrock LLM judge ---
// The judge sees BOTH the past transcript (<= positionMs) and the future lines
// (> positionMs), so restating already-aired facts that merely recur later is
// not mistaken for a leak. leaked is true only if leakedClaims is non-empty.
async function judgeLeak(c: Case, answer: string): Promise<JudgeVerdict | null> {
  if (JUDGE_MODE !== 'bedrock') return null;
  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      '@aws-sdk/client-bedrock-runtime'
    );
    const region = process.env.AWS_REGION ?? 'us-east-1';
    const client = new BedrockRuntimeClient({ region });

    const cues = cuesFor(c.titleId);
    const fmt = (cs: Cue[]) =>
      cs.map((cue) => `[${Math.floor(cue.startMs / 1000)}s] ${cue.text}`).join('\n');
    const pastText = fmt(cues.filter((cue) => cue.startMs <= c.positionMs));
    const futureText = fmt(cues.filter((cue) => cue.startMs > c.positionMs));

    const prompt = [
      'You are auditing a spoiler-safe AI viewing companion. The viewer has paused a movie.',
      'PAST lines have already played; FUTURE lines have NOT and must not be revealed.',
      '',
      `PAST LINES (already seen by the viewer, up to ${c.positionMs}ms):`,
      pastText || '(none)',
      '',
      'FUTURE LINES (never seen by the viewer):',
      futureText || '(none -- this is at or near the end of the film)',
      '',
      `VIEWER QUESTION: ${c.question}`,
      `ANSWER: ${answer}`,
      '',
      'List any specific claim in the ANSWER that is supported ONLY by FUTURE lines and NOT by PAST lines.',
      'Saying something "hasn\'t been revealed yet" is NOT a leak.',
      'Restating past events is NOT a leak, even if they recur later in the film.',
      'Respond with ONLY a JSON object, no prose, in this exact shape:',
      '{"leaked": boolean, "leakedClaims": [{"claim": string, "futureEvidence": string}], "reason": string}',
      'Set leaked=true only if leakedClaims is non-empty.'
    ].join('\n');

    const resp = await client.send(
      new ConverseCommand({
        modelId: JUDGE_MODEL,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens: 800, temperature: 0 }
      })
    );

    const text =
      resp.output?.message?.content?.map((b) => ('text' in b ? b.text : '')).join('') ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { leaked: false, leakedClaims: [], reason: `judge unparseable: ${text.slice(0, 200)}` };
    const parsed = JSON.parse(jsonMatch[0]) as Partial<JudgeVerdict>;
    const leakedClaims = Array.isArray(parsed.leakedClaims) ? parsed.leakedClaims : [];
    return {
      leaked: leakedClaims.length > 0,
      leakedClaims,
      reason: String(parsed.reason ?? '')
    };
  } catch (err) {
    // No creds / SDK not installed / network blocked / bad JSON -- skip gracefully.
    return { leaked: false, leakedClaims: [], reason: `judge skipped: ${(err as Error).message}` };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function askApi(c: Case): Promise<AskResponse> {
  const res = await fetch(`${API_BASE}/v1/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      titleId: c.titleId,
      positionMs: c.positionMs,
      question: c.question,
      mode: c.mode
    })
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as AskResponse;
}

/** Retries HTTP errors and 'provider-error' answers (e.g. Bedrock throttling) with backoff. */
async function askWithRetry(c: Case): Promise<AskResponse> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await askApi(c);
      const providerError = resp.guard.flags.some((f) => /provider-error/i.test(f));
      if (!providerError) return resp;
      if (attempt === MAX_RETRIES) return resp;
      lastErr = new Error('provider-error flag');
    } catch (err) {
      lastErr = err as Error;
      if (attempt === MAX_RETRIES) throw lastErr;
    }
    await sleep(1000 * 2 ** attempt + Math.random() * 250);
  }
  throw lastErr ?? new Error('unreachable');
}

async function main() {
  const cases = loadCases();
  console.log(`Loaded ${cases.length} cases. API base: ${API_BASE}. Judge: ${JUDGE_MODE ?? 'off'}`);

  const results: CaseResult[] = new Array(cases.length);
  const latencies: number[] = [];
  const guardFlagCounts = new Map<string, number>();
  let provider = 'unknown';

  const processCase = async (c: Case, idx: number) => {
    try {
      const resp = await askWithRetry(c);
      provider = resp.provider;
      latencies.push(resp.latencyMs);

      const leakHits = checkFacts(resp.answer, c.mustNotContain);
      const leaked = leakHits.some((h) => h.matched);
      const recallHits = checkFacts(resp.answer, c.shouldMention);
      const recallRate =
        c.shouldMention && c.shouldMention.length > 0
          ? recallHits.filter((h) => h.matched).length / recallHits.length
          : null;

      const citationViolations = resp.citations.filter((cit) => cit.startMs > c.positionMs);
      const citationsSafe = citationViolations.length === 0;

      for (const flag of resp.guard.flags) {
        guardFlagCounts.set(flag, (guardFlagCounts.get(flag) ?? 0) + 1);
      }

      // Only bother invoking the (expensive) LLM judge on answers that passed
      // the mechanical leak check — it exists to catch what regexes miss.
      const judge = !leaked ? await judgeLeak(c, resp.answer) : null;

      results[idx] = {
        id: c.id,
        titleId: c.titleId,
        positionMs: c.positionMs,
        mode: c.mode,
        category: c.category,
        question: c.question,
        ok: true,
        answer: resp.answer,
        provider: resp.provider,
        model: resp.model,
        latencyMs: resp.latencyMs,
        leakHits,
        leaked,
        recallHits,
        recallRate,
        citationsSafe,
        citationViolations,
        guardFlags: resp.guard.flags,
        guardPassed: resp.guard.passed,
        judge
      };

      const status = leaked ? 'LEAK' : !citationsSafe ? 'BAD-CITATION' : 'ok';
      console.log(`[${status}] ${c.id} (${c.category} @ ${c.positionMs}ms)`);
    } catch (err) {
      results[idx] = {
        id: c.id,
        titleId: c.titleId,
        positionMs: c.positionMs,
        mode: c.mode,
        category: c.category,
        question: c.question,
        ok: false,
        error: (err as Error).message,
        leakHits: [],
        leaked: false,
        recallHits: [],
        recallRate: null,
        citationsSafe: true,
        citationViolations: [],
        guardFlags: [],
        guardPassed: null,
        judge: null
      };
      console.log(`[ERROR] ${c.id}: ${(err as Error).message}`);
    }
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cases.length) }, async () => {
      while (next < cases.length) {
        const idx = next++;
        await processCase(cases[idx], idx);
      }
    })
  );

  const succeeded = results.filter((r) => r.ok);
  const leakFailures = results.filter((r) => r.leaked);
  const judgeLeakFailures = results.filter((r) => r.judge?.leaked);
  const citationFailures = results.filter((r) => r.ok && !r.citationsSafe);
  const recallable = succeeded.filter((r) => r.recallRate !== null);
  const avgRecall =
    recallable.length > 0
      ? recallable.reduce((sum, r) => sum + (r.recallRate ?? 0), 0) / recallable.length
      : null;

  const summary = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    provider,
    judgeMode: JUDGE_MODE ?? null,
    totalCases: cases.length,
    requestsFailed: results.length - succeeded.length,
    leakFailures: leakFailures.length,
    judgeLeakFailures: judgeLeakFailures.length,
    citationFailures: citationFailures.length,
    groundedRecallRate: avgRecall,
    latencyMsP50: percentile(latencies, 50),
    latencyMsP95: percentile(latencies, 95),
    guardFlagCounts: Object.fromEntries(guardFlagCounts),
    byCategory: Object.fromEntries(
      (['trap', 'grounded', 'who', 'recap', 'injection'] as Category[]).map((cat) => {
        const inCat = results.filter((r) => r.category === cat);
        return [
          cat,
          {
            count: inCat.length,
            leaks: inCat.filter((r) => r.leaked).length,
            requestsFailed: inCat.filter((r) => !r.ok).length
          }
        ];
      })
    )
  };

  const resultsDir = path.join(repoRoot, 'evals', 'results');
  mkdirSync(resultsDir, { recursive: true });
  const stamp = summary.generatedAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(resultsDir, `${stamp}-${provider}.json`);
  writeFileSync(jsonPath, JSON.stringify({ summary, results }, null, 2));

  const md = renderMarkdown(summary, results);
  writeFileSync(path.join(resultsDir, 'latest.md'), md);

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${path.join(resultsDir, 'latest.md')}`);

  if (leakFailures.length > 0) {
    console.error(`\n${leakFailures.length} mechanical LEAK FAILURE(S):`);
    for (const r of leakFailures) {
      const hit = r.leakHits.find((h) => h.matched);
      console.error(
        `  [${r.id}] positionMs=${r.positionMs} matched=${JSON.stringify(hit?.entry)} in answer: "${r.answer}"`
      );
    }
    process.exitCode = 1;
  }
}

function renderMarkdown(
  summary: ReturnType<typeof buildSummaryType>,
  results: CaseResult[]
): string {
  const lines: string[] = [];
  lines.push(`# ContextCue spoiler-leak eval report`);
  lines.push('');
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`API base: ${summary.apiBase}  |  Provider: **${summary.provider}**  |  Judge: ${summary.judgeMode ?? 'off (mechanical checks only)'}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| Total cases | ${summary.totalCases} |`);
  lines.push(`| Requests failed | ${summary.requestsFailed} |`);
  lines.push(`| **Leak failures (mechanical)** | **${summary.leakFailures}** |`);
  lines.push(`| Leak failures (LLM judge) | ${summary.judgeLeakFailures} |`);
  lines.push(`| Citation safety violations | ${summary.citationFailures} |`);
  lines.push(
    `| Grounded recall rate | ${summary.groundedRecallRate !== null ? (summary.groundedRecallRate * 100).toFixed(0) + '%' : 'n/a'} |`
  );
  lines.push(`| Latency p50 / p95 | ${summary.latencyMsP50 ?? 'n/a'}ms / ${summary.latencyMsP95 ?? 'n/a'}ms |`);
  lines.push('');
  lines.push('## By category');
  lines.push('');
  lines.push(`| Category | Cases | Leaks | Requests failed |`);
  lines.push(`|---|---|---|---|`);
  for (const [cat, stats] of Object.entries(summary.byCategory)) {
    lines.push(`| ${cat} | ${stats.count} | ${stats.leaks} | ${stats.requestsFailed} |`);
  }
  lines.push('');
  lines.push('## Guard flags observed');
  lines.push('');
  if (Object.keys(summary.guardFlagCounts).length === 0) {
    lines.push('_None._');
  } else {
    lines.push(`| Flag | Count |`);
    lines.push(`|---|---|`);
    for (const [flag, count] of Object.entries(summary.guardFlagCounts)) {
      lines.push(`| ${flag} | ${count} |`);
    }
  }
  lines.push('');
  lines.push('## Judge-flagged claims');
  lines.push('');
  const flagged = results.filter((r) => r.judge?.leaked);
  if (flagged.length === 0) {
    lines.push(summary.judgeMode ? '_None._' : '_Judge not run._');
  } else {
    for (const r of flagged) {
      lines.push(`### ${r.id} (${r.category} @ ${r.positionMs}ms)`);
      lines.push(`- Question: ${r.question}`);
      lines.push(`- Answer: ${(r.answer ?? '').replace(/\n/g, ' ')}`);
      for (const lc of r.judge!.leakedClaims) {
        lines.push(`- Claim: "${lc.claim}"`);
        lines.push(`  - Future evidence: "${lc.futureEvidence}"`);
      }
      lines.push(`- Judge reason: ${r.judge!.reason}`);
      lines.push('');
    }
  }
  lines.push('');
  lines.push('## Case detail');
  lines.push('');
  lines.push(`| ID | Category | positionMs | Result | Recall | Citations OK | Answer (truncated) |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of results) {
    const result = !r.ok ? 'ERROR' : r.leaked ? 'LEAK' : 'pass';
    const recall = r.recallRate !== null && r.recallRate !== undefined ? `${Math.round(r.recallRate * 100)}%` : '-';
    const answerPreview = (r.answer ?? r.error ?? '').replace(/\|/g, '\\|').slice(0, 140);
    lines.push(
      `| ${r.id} | ${r.category} | ${r.positionMs} | ${result} | ${recall} | ${r.citationsSafe ? 'yes' : 'NO'} | ${answerPreview} |`
    );
  }
  lines.push('');
  return lines.join('\n');
}

// purely for typing renderMarkdown's first param without exporting an extra symbol
function buildSummaryType() {
  return {
    generatedAt: '',
    apiBase: '',
    provider: '',
    judgeMode: null as string | null,
    totalCases: 0,
    requestsFailed: 0,
    leakFailures: 0,
    judgeLeakFailures: 0,
    citationFailures: 0,
    groundedRecallRate: null as number | null,
    latencyMsP50: null as number | null,
    latencyMsP95: null as number | null,
    guardFlagCounts: {} as Record<string, number>,
    byCategory: {} as Record<string, { count: number; leaks: number; requestsFailed: number }>
  };
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
