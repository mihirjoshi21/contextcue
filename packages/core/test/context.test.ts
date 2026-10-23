import { describe, it, expect } from 'vitest';
import { cuesUpTo, buildContext } from '../src/context.js';
import { cue, sampleStory, syntheticFilm } from './fixtures.js';

const TWENTY_MIN_MS = 20 * 60 * 1000;
const NINETY_MIN_MS = 90 * 60 * 1000;

describe('cuesUpTo', () => {
  it('excludes cues that start after positionMs', () => {
    const cues = sampleStory();
    const result = cuesUpTo(cues, 100_000); // 100s
    expect(result.every((c) => c.startMs <= 100_000)).toBe(true);
    expect(result.some((c) => c.startMs > 100_000)).toBe(false);
  });

  it('keeps a cue that straddles the playhead (started before, has not ended)', () => {
    const cues = [cue(1, 10, 20, 'Straddling line.')];
    const result = cuesUpTo(cues, 15_000); // mid-cue
    expect(result).toHaveLength(1);
  });

  it('drops a cue that has not started yet even by one millisecond', () => {
    const cues = [cue(1, 10, 20, 'Future line.')];
    expect(cuesUpTo(cues, 9_999)).toHaveLength(0);
    expect(cuesUpTo(cues, 10_000)).toHaveLength(1);
  });

  it('returns cues in chronological order regardless of input order', () => {
    const cues = [cue(2, 10, 12, 'second'), cue(1, 0, 2, 'first')];
    const result = cuesUpTo(cues, 15_000);
    expect(result.map((c) => c.text)).toEqual(['first', 'second']);
  });
});

describe('buildContext', () => {
  it('marks full=true and includes everything when the whole past fits the budget', () => {
    const cues = sampleStory();
    const ctx = buildContext(cues, 900_000, 'why the keeper disappeared');
    expect(ctx.full).toBe(true);
    expect(ctx.retrieved).toHaveLength(0);
    expect(ctx.cueCount).toBe(cuesUpTo(cues, 900_000).length);
  });

  it('never includes a cue after positionMs (maxCueStartMs invariant)', () => {
    const cues = sampleStory();
    const ctx = buildContext(cues, 250_000, 'keeper storm', { maxChars: 50 });
    expect(ctx.maxCueStartMs).toBeLessThanOrEqual(250_000);
    for (const c of [...ctx.recent, ...ctx.retrieved]) {
      expect(c.startMs).toBeLessThanOrEqual(250_000);
    }
  });

  it('returns an empty-but-valid context when nothing has played yet', () => {
    const cues = sampleStory();
    const ctx = buildContext(cues, 0, 'anything');
    // Only cue(1, 0, 3, ...) starts at ms 0, so it is included.
    expect(ctx.maxCueStartMs).toBeLessThanOrEqual(0);
    expect(ctx.recent.every((c) => c.startMs <= 0)).toBe(true);
  });

  it('includes recent cues verbatim and BM25-relevant older cues with neighbors, in chronological order', () => {
    const cues = sampleStory();
    // positionMs = 705s so "recent window" (default 180s) covers roughly 525s-705s.
    const ctx = buildContext(cues, 705_000, 'why did the keeper disappear', {
      recentWindowMs: 180_000,
      maxChars: 500,
      retrieveK: 3
    });
    expect(ctx.full).toBe(false);
    // The keeper/storm cues (8, 9) are outside the recent window and should
    // be pulled in by BM25 relevance to the question.
    const retrievedTexts = ctx.retrieved.map((c) => c.text);
    expect(retrievedTexts.some((t) => t.includes('keeper'))).toBe(true);
    // `retrieved` itself must be in chronological order.
    const retrievedStarts = ctx.retrieved.map((c) => c.startMs);
    const sortedStarts = [...retrievedStarts].sort((a, b) => a - b);
    expect(retrievedStarts).toEqual(sortedStarts);
  });

  it('deduplicates cues that would otherwise appear in both recent and retrieved', () => {
    const cues = sampleStory();
    const ctx = buildContext(cues, 705_000, 'lighthouse keeper storm', { retrieveK: 12, maxChars: 24_000 });
    const keys = [...ctx.recent, ...ctx.retrieved].map((c) => `${c.index}:${c.startMs}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('respects the maxChars budget', () => {
    const cues = sampleStory();
    const ctx = buildContext(cues, 900_000, 'keeper storm logbook trapdoor', { maxChars: 120, recentWindowMs: 10_000 });
    expect(ctx.charCount).toBeLessThanOrEqual(120);
  });

  it('falls back to coverage sampling (not empty) when the question is blank, by default', () => {
    const cues = sampleStory();
    const ctx = buildContext(cues, 900_000, '', { maxChars: 150, recentWindowMs: 10_000 });
    // 'auto' (the default) always tops up leftover budget with stride-sampled
    // coverage of the older cues, precisely so recap/who/scene (blank
    // question) don't collapse to only the last 10s of dialogue.
    expect(ctx.retrieved.length).toBeGreaterThan(0);
  });

  it('strategy "retrieval" produces no retrieval when the question is blank (opt-in old behavior)', () => {
    const cues = sampleStory();
    const ctx = buildContext(cues, 900_000, '', {
      maxChars: 150,
      recentWindowMs: 10_000,
      strategy: 'retrieval'
    });
    expect(ctx.retrieved).toHaveLength(0);
  });
});

describe('buildContext: long-film "catch me up" coverage (bug regression)', () => {
  it('a recap-style call (blank question) at 1:30:00 of a 2h film still includes cues from the first 20 minutes, with default options', () => {
    const film = syntheticFilm(7200, 5); // one line every 5s for 2 hours = 1440 cues (well over the 60000-char default budget by the 90-minute mark)
    // Default recentWindowMs (3 min) + default maxChars (60000) + blank question,
    // exactly the shape of a real recap/who/scene call.
    const ctx = buildContext(film, NINETY_MIN_MS, '');
    expect(ctx.full).toBe(false); // 1080 cues of ~92 chars each by 90 min is well over the 60000-char budget
    const all = ctx.recent.concat(ctx.retrieved);
    expect(all.some((c) => c.startMs < TWENTY_MIN_MS)).toBe(true);
    // And it must still never include anything after the playhead.
    expect(all.every((c) => c.startMs <= NINETY_MIN_MS)).toBe(true);
  });

  it('still includes early cues when the question DOES have BM25 hits (auto tops up leftover budget)', () => {
    const film = syntheticFilm(7200, 5);
    const ctx = buildContext(film, NINETY_MIN_MS, 'plan');
    const all = ctx.recent.concat(ctx.retrieved);
    expect(all.some((c) => c.startMs < TWENTY_MIN_MS)).toBe(true);
  });

  it('strategy "coverage" spans the whole past regardless of the question', () => {
    const film = syntheticFilm(7200, 5);
    const ctx = buildContext(film, NINETY_MIN_MS, 'irrelevant gibberish query xyz', { strategy: 'coverage' });
    const all = ctx.recent.concat(ctx.retrieved);
    expect(all.some((c) => c.startMs < TWENTY_MIN_MS)).toBe(true);
  });

  it('strategy "retrieval" with a blank question does NOT cover the early part of the film (the old, buggy shape, kept available opt-in)', () => {
    const film = syntheticFilm(7200, 5);
    const ctx = buildContext(film, NINETY_MIN_MS, '', { strategy: 'retrieval' });
    const all = ctx.recent.concat(ctx.retrieved);
    expect(all.every((c) => c.startMs >= NINETY_MIN_MS - 180_000)).toBe(true);
  });
});
