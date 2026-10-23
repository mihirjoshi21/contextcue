import { describe, it, expect } from 'vitest';
import type { SpoilerSafeContext } from '@contextcue/core';
import { buildCitations } from '../src/citations.js';

function ctx(overrides: Partial<SpoilerSafeContext> = {}): SpoilerSafeContext {
  return {
    positionMs: 20_000,
    recent: [],
    retrieved: [],
    full: true,
    cueCount: 0,
    charCount: 0,
    maxCueStartMs: 20_000,
    ...overrides
  };
}

describe('buildCitations safety net', () => {
  it('never returns a citation with startMs > safeMs, even if the pool itself contains a future cue', () => {
    const context = ctx({
      recent: [
        { index: 1, startMs: 1000, endMs: 2000, text: 'Alice says hi.' },
        { index: 2, startMs: 300_000, endMs: 301_000, text: 'SECRET_FUTURE_LINE leak.' }
      ]
    });

    const citations = buildCitations('Alice says hi [00:01].', context, 20_000);

    for (const c of citations) {
      expect(c.startMs).toBeLessThanOrEqual(20_000);
    }
    expect(citations.some((c) => c.text.includes('SECRET_FUTURE_LINE'))).toBe(false);
  });

  it('maps a cited [mm:ss] timestamp to the nearest past cue', () => {
    const context = ctx({
      recent: [
        { index: 1, startMs: 1000, endMs: 2000, text: 'Line A.' },
        { index: 2, startMs: 5000, endMs: 6000, text: 'Line B.' },
        { index: 3, startMs: 10_000, endMs: 11_000, text: 'Line C.' }
      ]
    });

    const citations = buildCitations('This happened [00:05].', context, 20_000);
    expect(citations).toHaveLength(1);
    expect(citations[0].startMs).toBe(5000);
    expect(citations[0].text).toBe('Line B.');
  });

  it('falls back to recent cues when the answer cites no timestamps', () => {
    const context = ctx({
      recent: [
        { index: 1, startMs: 1000, endMs: 2000, text: 'Line A' },
        { index: 2, startMs: 5000, endMs: 6000, text: 'Line B' }
      ]
    });

    const citations = buildCitations('No timestamps here.', context, 20_000);
    expect(citations.length).toBeGreaterThan(0);
    for (const c of citations) expect(c.startMs).toBeLessThanOrEqual(20_000);
  });

  it('returns an empty array when there are no past cues at all', () => {
    const citations = buildCitations('Anything.', ctx(), 20_000);
    expect(citations).toEqual([]);
  });

  it('expands a cited fragment into a fuller sentence-ish span by joining adjacent cues', () => {
    const context = ctx({
      recent: [
        { index: 1, startMs: 1000, endMs: 2000, text: 'Somebody?' },
        { index: 2, startMs: 3000, endMs: 4000, text: 'Here I have it.' },
        { index: 3, startMs: 6000, endMs: 8000, text: 'Drag a couple of those' },
        { index: 4, startMs: 9000, endMs: 11_000, text: 'over to the porch.' }
      ]
    });

    const citations = buildCitations('This happened [00:06].', context, 20_000);
    expect(citations).toHaveLength(1);
    // "Drag a couple of those" is an unfinished fragment (no terminal punctuation);
    // it should absorb the following cue up to the sentence-ending period, but NOT
    // the earlier, already-finished "Here I have it." sentence before it.
    expect(citations[0].text).toBe('Drag a couple of those over to the porch.');
    expect(citations[0].startMs).toBe(6000);
    expect(citations[0].endMs).toBe(11_000);
  });

  it('never joins forward into an adjacent cue that is past the safe position, even when the base cue is an unfinished fragment', () => {
    // "Somebody said" has no terminal punctuation, so naively it would keep reading
    // forward looking for the end of the sentence — but the very next cue by index
    // is in the future relative to safeMs, so the HARD CEILING inside the expansion
    // itself (not just the pool's upfront filter) must stop it from ever being joined.
    const context = ctx({
      recent: [
        { index: 1, startMs: 1000, endMs: 2000, text: 'Somebody said' },
        { index: 2, startMs: 300_000, endMs: 301_000, text: 'SECRET_FUTURE_LINE leak.' }
      ]
    });

    const citations = buildCitations('Somebody said [00:01].', context, 20_000);
    expect(citations).toHaveLength(1);
    expect(citations[0].text).toBe('Somebody said');
    expect(citations[0].text).not.toContain('SECRET_FUTURE_LINE');
    expect(citations[0].startMs).toBeLessThanOrEqual(20_000);
  });
});

describe('buildCitations de-duplication', () => {
  it('drops overlapping/near-identical expanded spans, keeps the earliest, caps at 3, honors the ceiling', () => {
    const cues = [
      { index: 1, startMs: 1000, endMs: 4000, text: "What's happening? There are two of them." },
      { index: 2, startMs: 4000, endMs: 7000, text: 'I can take care of those two.' },
      { index: 3, startMs: 7000, endMs: 9000, text: 'take care of those two.' },
      { index: 4, startMs: 12000, endMs: 15000, text: 'A totally different line.' },
      { index: 5, startMs: 50000, endMs: 52000, text: 'FUTURE take care of those two.' }
    ];
    const context = ctx({ recent: cues, maxCueStartMs: 12000, positionMs: 20_000 });
    const out = buildCitations('See [0:01] [0:05] [0:07] [0:12] [0:50].', context, 20_000);
    expect(out.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMs).toBeGreaterThanOrEqual(out[i - 1].endMs);
    }
    expect(out.some((c) => c.text.includes('FUTURE'))).toBe(false);
    expect(out.every((c) => c.startMs <= 20_000)).toBe(true);
    expect(out.filter((c) => c.text.includes('take care of those two')).length).toBeLessThanOrEqual(1);
  });
});
