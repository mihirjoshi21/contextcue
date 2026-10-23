import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cuesUpTo, buildContext } from '../src/context.js';
import { buildPrompt, type AskMode } from '../src/prompt.js';
import type { Cue } from '../src/types.js';

/**
 * Property tests for the HARD CEILING invariant: no cue with
 * `startMs > positionMs` may ever appear in `cuesUpTo`, `buildContext`'s
 * output, or the rendered prompt text — across randomly generated subtitle
 * sets and playback positions.
 */

const cueItemArb = fc.record({
  startSec: fc.integer({ min: 0, max: 2000 }),
  durationSec: fc.integer({ min: 0, max: 30 })
});

/** Random cue lists, each cue tagged with a unique `markerN` token so tests
 * can check for verbatim text leakage, not just timestamp comparisons. */
const cuesArb: fc.Arbitrary<Cue[]> = fc.array(cueItemArb, { minLength: 0, maxLength: 60 }).map((items) =>
  items.map(
    (item, i): Cue => ({
      index: i + 1,
      startMs: item.startSec * 1000,
      endMs: (item.startSec + item.durationSec) * 1000,
      text: `marker${i + 1} the mysterious plot unfolds with dialogue about the storm and the keeper`
    })
  )
);

const positionArb = fc.integer({ min: 0, max: 2_500_000 });
const modeArb: fc.Arbitrary<AskMode> = fc.constantFrom('ask', 'recap', 'who', 'scene');

describe('property: hard ceiling holds for cuesUpTo', () => {
  it('never returns a cue that starts after positionMs', () => {
    fc.assert(
      fc.property(cuesArb, positionArb, (cues, positionMs) => {
        const result = cuesUpTo(cues, positionMs);
        return result.every((c) => c.startMs <= positionMs);
      }),
      { numRuns: 300 }
    );
  });

  it('is idempotent and monotonic: a later position never excludes a cue an earlier position included', () => {
    fc.assert(
      fc.property(cuesArb, positionArb, fc.integer({ min: 0, max: 500_000 }), (cues, positionMs, delta) => {
        const before = cuesUpTo(cues, positionMs);
        const after = cuesUpTo(cues, positionMs + delta);
        const beforeKeys = new Set(before.map((c) => `${c.index}:${c.startMs}`));
        const afterKeys = new Set(after.map((c) => `${c.index}:${c.startMs}`));
        return [...beforeKeys].every((k) => afterKeys.has(k));
      }),
      { numRuns: 200 }
    );
  });
});

describe('property: hard ceiling holds for buildContext', () => {
  it('never includes a future cue and always reports maxCueStartMs <= positionMs', () => {
    fc.assert(
      fc.property(cuesArb, positionArb, fc.string({ maxLength: 40 }), (cues, positionMs, question) => {
        const ctx = buildContext(cues, positionMs, question);
        const all = ctx.recent.concat(ctx.retrieved);
        const noFuture = all.every((c) => c.startMs <= positionMs);
        return noFuture && ctx.maxCueStartMs <= positionMs;
      }),
      { numRuns: 300 }
    );
  });

  it('respects an arbitrary maxChars budget', () => {
    fc.assert(
      fc.property(
        cuesArb,
        positionArb,
        fc.integer({ min: 0, max: 5000 }),
        (cues, positionMs, maxChars) => {
          const ctx = buildContext(cues, positionMs, 'storm keeper plot', { maxChars });
          return ctx.charCount <= maxChars;
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('property: buildPrompt never renders text from a future cue', () => {
  it('contains no marker token belonging to a cue after positionMs', () => {
    fc.assert(
      fc.property(cuesArb, positionArb, modeArb, (cues, positionMs, mode) => {
        const ctx = buildContext(cues, positionMs, 'what happened with the storm and the keeper');
        const built = buildPrompt({ mode, question: 'What just happened?', context: ctx });
        const combined = `${built.system}\n${built.user}`;
        const futureCues = cues.filter((c) => c.startMs > positionMs);
        return futureCues.every((c) => !combined.includes(`marker${c.index} `));
      }),
      { numRuns: 300 }
    );
  });
});
