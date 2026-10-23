#!/usr/bin/env node
/**
 * Self-contained sanity check for evals/cases/*.json — does NOT depend on
 * @contextcue/core, so it stays correct even if the core parser changes.
 *
 * For every case's mustNotContain / shouldMention entry, finds the first cue
 * in the title's .srt whose text matches, and asserts:
 *   - mustNotContain: first match's startMs is STRICTLY AFTER positionMs
 *     (or there is no match anywhere in the file at all — also safe)
 *   - shouldMention: first match's startMs is AT OR BEFORE positionMs
 *
 * This is how we back up the claim in the eval cases that every
 * mustNotContain fact was "derived from the subtitle file and verified".
 *
 * Usage: node evals/scripts/verify-cases.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const casesDir = path.resolve(__dirname, '../cases');
const contentDir = path.resolve(repoRoot, 'content');

function parseSrt(text) {
  const cues = [];
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
    const toMs = (h, mm, s, ms) => ((+h * 60 + +mm) * 60 + +s) * 1000 + +ms;
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const text2 = lines
      .slice(timeLineIdx + 1)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    cues.push({ startMs, endMs, text: text2 });
  }
  return cues;
}

function toMatcher(entry) {
  const regexLit = entry.match(/^\/(.*)\/([a-z]*)$/);
  if (regexLit) return new RegExp(regexLit[1], regexLit[2]);
  return new RegExp(entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function firstMatch(cues, entry) {
  const re = toMatcher(entry);
  for (const c of cues) {
    if (re.test(c.text)) return c;
  }
  return undefined;
}

const titlesMeta = JSON.parse(readFileSync(path.join(contentDir, 'titles.json'), 'utf8'));
const cuesByTitle = new Map();
function cuesFor(titleId) {
  if (cuesByTitle.has(titleId)) return cuesByTitle.get(titleId);
  const meta = titlesMeta.find((t) => t.id === titleId);
  if (!meta) throw new Error(`Unknown titleId ${titleId} (check content/titles.json)`);
  const srt = readFileSync(path.join(contentDir, meta.subtitles), 'utf8');
  const cues = parseSrt(srt);
  cuesByTitle.set(titleId, cues);
  return cues;
}

let totalFacts = 0;
let failures = 0;
const caseFiles = readdirSync(casesDir).filter((f) => f.endsWith('.json'));

for (const file of caseFiles) {
  const doc = JSON.parse(readFileSync(path.join(casesDir, file), 'utf8'));
  const cases = doc.cases ?? doc;
  for (const c of cases) {
    const cues = cuesFor(c.titleId);
    for (const entry of c.mustNotContain ?? []) {
      totalFacts++;
      const hit = firstMatch(cues, entry);
      if (hit && hit.startMs <= c.positionMs) {
        failures++;
        console.log(
          `FAIL [${c.id}] mustNotContain ${JSON.stringify(entry)} first appears at ${hit.startMs}ms ("${hit.text}"), which is <= positionMs ${c.positionMs}ms -- this case is derived incorrectly.`
        );
      }
    }
    for (const entry of c.shouldMention ?? []) {
      totalFacts++;
      const hit = firstMatch(cues, entry);
      if (!hit || hit.startMs > c.positionMs) {
        failures++;
        console.log(
          `FAIL [${c.id}] shouldMention ${JSON.stringify(entry)} ${
            hit ? `first appears at ${hit.startMs}ms, which is AFTER positionMs ${c.positionMs}ms` : 'never appears in the subtitle file'
          } -- this case is derived incorrectly.`
        );
      }
    }
  }
}

console.log(`\nChecked ${totalFacts} fact assertions across ${caseFiles.join(', ')}.`);
if (failures > 0) {
  console.log(`${failures} FAILED. Fix evals/cases/*.json before trusting the eval results.`);
  process.exit(1);
} else {
  console.log('All mustNotContain/shouldMention facts verified against the source .srt files. OK.');
}
