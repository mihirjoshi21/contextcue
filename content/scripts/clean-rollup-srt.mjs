#!/usr/bin/env node
/**
 * clean-rollup-srt.mjs
 *
 * Cleans a YouTube/archive.org-style "roll-up" ASR .srt (word-level timing
 * tags + heavily duplicated/overlapping cues where each new cue repeats the
 * tail of the previous one) into a compact, sentence-ish, non-duplicated
 * .srt suitable for a spoiler-safe subtitle-driven Q&A product.
 *
 * No dependencies. Node >= 18.
 *
 * Usage:
 *   node clean-rollup-srt.mjs <input.srt> <output.srt> [--exclude=ranges.json] [--start=MS] [--end=MS]
 *
 * --exclude=ranges.json (recommended, reproducible): a JSON file containing
 * an array of `{ "startMs": N, "endMs": N, "label": "..." }` objects. Any cue
 * whose ORIGINAL start time falls inside [startMs, endMs) for ANY listed
 * range is dropped before cleaning -- used to cut non-film segments (a
 * rebroadcast's host intro, a mid-film host digression, a host outro, etc.)
 * out of a subtitle track while leaving the underlying video file (and its
 * absolute timestamps) completely untouched. Ranges may appear anywhere in
 * the file and in any order; they are not required to be contiguous.
 *
 * --start / --end (both optional, in milliseconds, legacy/simple form): kept
 * for convenience -- equivalent to adding one more exclude range covering
 * [0, start) and [end, Infinity). Combine freely with --exclude.
 *
 * Pipeline:
 *   1. Parse raw cues, strip inline word-level timing tags <hh:mm:ss.mmm> and
 *      decode HTML entities (&gt;&gt; -> literal ">>").
 *   2. Drop cues in any excluded range (see --exclude / --start / --end above).
 *   3. De-duplicate roll-up captions: for each cue, strip the longest run of
 *      leading tokens that match the trailing tokens of the PREVIOUS cue's
 *      (already tag-stripped) original text. Cues that become fully empty
 *      are dropped.
 *   4. Split remaining ">>"/"—" speaker-change markers into separate cues
 *      (each becomes the start of a new line rather than an inline dash),
 *      slicing time proportionally by character length.
 *   5. Merge any surviving cue with <= 2 words of new content into a
 *      neighboring cue (forward if possible, else backward) so we don't emit
 *      tiny fragments.
 *   6. Re-segment any cue whose text exceeds ~90 chars into sentence-ish
 *      pieces (split on . ? !), slicing time proportionally by character
 *      length.
 *   7. Squash immediate word/phrase stutter repeats within a single cue
 *      (e.g. "Heat. Heat. Heat." -> "Heat.") -- a common ASR artifact on
 *      background noise, distinct from the cross-cue roll-up dedup in step 3.
 *   8. Fix a short list of known ASR typos.
 *   9. Enforce monotonic, non-decreasing timestamps as a final safety net.
 *      Cues are only ever pushed LATER than their original recognition time,
 *      never earlier -- this preserves the product's spoiler-ceiling
 *      invariant (a cue's start must never precede when it was actually
 *      spoken).
 *
 * This is a heuristic best-effort cleaner for messy ASR output, not a
 * general-purpose subtitle library. It is intentionally dependency-free and
 * single-file so it can be re-run against any similarly-shaped ASR .srt.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const TYPO_FIXES = [
  [/\bmorgs\b/gi, 'morgues'],
  [/\bhighle\b/gi, 'high-level'],
  [/\bposi\b(?=,)/gi, 'posse'],
];

function decodeEntities(s) {
  return s
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripWordTags(s) {
  return s.replace(/<\d\d:\d\d:\d\d[.,]\d+>/g, '');
}

function tsToMs(ts) {
  const norm = ts.replace(',', '.');
  const m = norm.match(/(\d\d):(\d\d):(\d\d)\.(\d+)/);
  if (!m) throw new Error(`bad timestamp: ${ts}`);
  const [, h, mi, s, ms] = m;
  return (
    Number(h) * 3600000 +
    Number(mi) * 60000 +
    Number(s) * 1000 +
    Number(ms.padEnd(3, '0').slice(0, 3))
  );
}

function msToTs(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000);
  ms %= 3600000;
  const m = Math.floor(ms / 60000);
  ms %= 60000;
  const s = Math.floor(ms / 1000);
  ms %= 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function parseSrt(text) {
  const blocks = text.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;
    let tsLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsLineIdx === -1) continue;
    const m = lines[tsLineIdx].match(
      /(\d\d:\d\d:\d\d[.,]\d+)\s*-->\s*(\d\d:\d\d:\d\d[.,]\d+)/,
    );
    if (!m) continue;
    const start = tsToMs(m[1]);
    const end = tsToMs(m[2]);
    let raw = lines.slice(tsLineIdx + 1).join(' ');
    raw = decodeEntities(stripWordTags(raw));
    raw = raw.replace(/\s+/g, ' ').trim();
    cues.push({ start, end, text: raw });
  }
  return cues;
}

function normToken(tok) {
  return tok.toLowerCase().replace(/[^a-z0-9']/g, '');
}

function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

// Strip the longest prefix of `curr` tokens that equals a suffix of `prev`
// tokens (normalized comparison), returning the remaining (new) tokens.
function stripRollupOverlap(prevTokens, currTokens) {
  const prevNorm = prevTokens.map(normToken);
  const currNorm = currTokens.map(normToken);
  const maxK = Math.min(prevNorm.length, currNorm.length);
  for (let k = maxK; k > 0; k--) {
    const prevTail = prevNorm.slice(prevNorm.length - k);
    const currHead = currNorm.slice(0, k);
    if (prevTail.every((t, i) => t === currHead[i])) {
      return currTokens.slice(k);
    }
  }
  return currTokens;
}

function dedupeRollup(cues) {
  const out = [];
  let prevTokens = [];
  for (const cue of cues) {
    const currTokens = tokenize(cue.text);
    const newTokens = prevTokens.length
      ? stripRollupOverlap(prevTokens, currTokens)
      : currTokens;
    prevTokens = currTokens; // compare against ORIGINAL previous text, not the deduped remainder
    if (newTokens.length === 0) continue; // fully duplicate cue, drop
    out.push({ start: cue.start, end: cue.end, text: newTokens.join(' ') });
  }
  return out;
}

// Split a cue's text on ">>" / "—" speaker-change markers into separate
// cues, slicing [start, end) proportionally by character length.
function splitSpeakerMarkers(cues) {
  const out = [];
  for (const cue of cues) {
    const normalized = cue.text.replace(/>>/g, '—');
    const parts = normalized
      .split('—')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length <= 1) {
      out.push({ start: cue.start, end: cue.end, text: parts[0] ?? cue.text });
      continue;
    }
    const totalLen = parts.reduce((a, p) => a + p.length, 0) || 1;
    const span = Math.max(0, cue.end - cue.start);
    let cursor = cue.start;
    for (const part of parts) {
      const share = span * (part.length / totalLen);
      const segStart = cursor;
      const segEnd = cursor + share;
      out.push({ start: segStart, end: segEnd, text: part });
      cursor = segEnd;
    }
  }
  return out;
}

// Merge cues with <= `minWords` words into a neighbor so we don't emit tiny
// fragments left over after rollup de-duplication.
function mergeTinyCues(cues, minWords = 2) {
  const list = cues.map((c) => ({ ...c }));
  let i = 0;
  while (i < list.length) {
    const wordCount = tokenize(list[i].text).length;
    if (wordCount > minWords || list.length === 1) {
      i++;
      continue;
    }
    if (i + 1 < list.length) {
      // merge forward: prepend this cue's text to the next cue
      list[i + 1] = {
        start: list[i].start,
        end: list[i + 1].end,
        text: `${list[i].text} ${list[i + 1].text}`.trim(),
      };
      list.splice(i, 1);
      // re-check the merged cue (now at index i) in case it's still tiny
      continue;
    } else if (i > 0) {
      // last cue in the list and it's tiny: merge backward into previous
      list[i - 1] = {
        start: list[i - 1].start,
        end: list[i].end,
        text: `${list[i - 1].text} ${list[i].text}`.trim(),
      };
      list.splice(i, 1);
      i--; // re-check merged previous cue
      continue;
    } else {
      i++;
    }
  }
  return list;
}

// Re-segment any cue longer than maxChars into sentence-ish pieces, slicing
// time proportionally by character length.
function resegmentLongCues(cues, maxChars = 90) {
  const out = [];
  const sentenceSplit = (text) => {
    const pieces = text.match(/[^.?!]+[.?!]?/g) || [text];
    return pieces.map((p) => p.trim()).filter(Boolean);
  };
  for (const cue of cues) {
    if (cue.text.length <= maxChars) {
      out.push(cue);
      continue;
    }
    const parts = sentenceSplit(cue.text);
    if (parts.length <= 1) {
      out.push(cue);
      continue;
    }
    const totalLen = parts.reduce((a, p) => a + p.length, 0) || 1;
    const span = Math.max(0, cue.end - cue.start);
    let cursor = cue.start;
    for (const part of parts) {
      const share = span * (part.length / totalLen);
      const segStart = cursor;
      const segEnd = cursor + share;
      out.push({ start: segStart, end: segEnd, text: part });
      cursor = segEnd;
    }
  }
  return out;
}

// Squash immediate word/phrase stutter repeats within a single cue (e.g. an
// ASR mishearing background noise as "Heat. Heat. Heat." several cues in a
// row within one span) down to a single occurrence. Deliberately narrow: only
// collapses a token (or short phrase) IMMEDIATELY repeated back-to-back,
// which in ASR output is overwhelmingly a recognition artifact rather than
// genuine emphatic repetition in dialogue.
function squashStutter(cues) {
  return cues.map((c) => {
    const text = c.text.replace(
      /\b(\w+[.,!?]*)(?:\s+\1(?!\w))+/gi,
      '$1',
    );
    return { ...c, text };
  });
}

function applyTypoFixes(cues) {
  return cues.map((c) => {
    let text = c.text;
    for (const [re, replacement] of TYPO_FIXES) {
      text = text.replace(re, replacement);
    }
    return { ...c, text };
  });
}

// Final safety net: cues may only be pushed LATER, never earlier, than their
// original recognition time -- this preserves the spoiler-ceiling invariant.
function enforceMonotonic(cues) {
  const out = [];
  let prevEnd = 0;
  for (const cue of cues) {
    let start = cue.start;
    let end = cue.end;
    if (start < prevEnd) start = prevEnd;
    if (end < start) end = start + 200; // minimal epsilon, never earlier
    out.push({ start, end, text: cue.text });
    prevEnd = end;
  }
  return out;
}

function formatSrt(cues) {
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${msToTs(c.start)} --> ${msToTs(c.end)}\n${c.text}\n`,
    )
    .join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const flags = Object.fromEntries(
    args
      .filter((a) => a.startsWith('--'))
      .map((a) => {
        const [k, v] = a.slice(2).split('=');
        return [k, v];
      }),
  );
  const [inputPath, outputPath] = positional;
  if (!inputPath || !outputPath) {
    console.error(
      'Usage: node clean-rollup-srt.mjs <input.srt> <output.srt> [--exclude=ranges.json] [--start=MS] [--end=MS]',
    );
    process.exit(1);
  }

  const excludeRanges = [];
  if (flags.exclude) {
    const data = JSON.parse(readFileSync(flags.exclude, 'utf-8'));
    for (const r of data) {
      excludeRanges.push({ startMs: Number(r.startMs), endMs: Number(r.endMs) });
    }
  }
  if (flags.start !== undefined) {
    excludeRanges.push({ startMs: 0, endMs: Number(flags.start) });
  }
  if (flags.end !== undefined) {
    excludeRanges.push({ startMs: Number(flags.end), endMs: Infinity });
  }
  const isExcluded = (startMs) =>
    excludeRanges.some((r) => startMs >= r.startMs && startMs < r.endMs);

  const raw = readFileSync(inputPath, 'utf-8');
  let cues = parseSrt(raw);
  const totalCharsBefore = cues.reduce((a, c) => a + c.text.length, 0);
  const cueCountBefore = cues.length;

  cues = cues.filter((c) => !isExcluded(c.start));
  cues = dedupeRollup(cues);
  cues = splitSpeakerMarkers(cues);
  cues = mergeTinyCues(cues, 2);
  cues = resegmentLongCues(cues, 90);
  cues = squashStutter(cues);
  cues = applyTypoFixes(cues);
  cues = cues.filter((c) => c.text.length > 0);
  cues = enforceMonotonic(cues);

  const totalCharsAfter = cues.reduce((a, c) => a + c.text.length, 0);

  writeFileSync(outputPath, formatSrt(cues), 'utf-8');

  console.log(`input cues (raw, untrimmed):  ${cueCountBefore}`);
  console.log(`input chars (raw, untrimmed): ${totalCharsBefore}`);
  console.log(`output cues:                  ${cues.length}`);
  console.log(`output chars:                 ${totalCharsAfter}`);
  console.log(
    `first cue: ${msToTs(cues[0].start)} --> ${msToTs(cues[0].end)}  "${cues[0].text}"`,
  );
  console.log(
    `last cue:  ${msToTs(cues.at(-1).start)} --> ${msToTs(cues.at(-1).end)}  "${cues.at(-1).text}"`,
  );

  const midStart = Math.floor(cues.length / 2) - 7;
  console.log('\n--- 15 sample cues from the middle ---');
  for (let i = Math.max(0, midStart); i < Math.min(cues.length, midStart + 15); i++) {
    const c = cues[i];
    console.log(`[${i + 1}] ${msToTs(c.start)} --> ${msToTs(c.end)}\n    ${c.text}`);
  }
}

main();
