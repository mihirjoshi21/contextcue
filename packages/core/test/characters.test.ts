import { describe, it, expect } from 'vitest';
import { extractCharacters } from '../src/characters.js';
import { cue, sampleStory } from './fixtures.js';

describe('extractCharacters', () => {
  it('finds names that appear mid-sentence at least twice', () => {
    const cues = sampleStory();
    const result = extractCharacters(cues, 900_000);
    const names = result.map((c) => c.name);
    expect(names).toContain('Alice');
    expect(names).toContain('Bob');
    expect(names).toContain('Carol');
  });

  it('qualifies a name via vocative address ("Hey X"), reportable with minMentions:1', () => {
    const cues = [cue(1, 0, 3, 'Hey Zara, watch out for that step!')];
    // Default minMentions is 2 (see below); a single vocative mention still
    // *qualifies* Zara as a candidate, so opting into a lower threshold
    // surfaces her even though she's only mentioned once here.
    const result = extractCharacters(cues, 900_000, { minMentions: 1 });
    expect(result.map((c) => c.name)).toContain('Zara');
  });

  it('qualifies a name via a trailing vocative comma ("X, wait!"), reportable with minMentions:1', () => {
    const cues = [cue(1, 0, 3, 'Marcus, wait for me by the door!')];
    const result = extractCharacters(cues, 900_000, { minMentions: 1 });
    expect(result.map((c) => c.name)).toContain('Marcus');
  });

  it('defaults to requiring minMentions:2, so a single vocative mention alone is not reported', () => {
    const cues = [cue(1, 0, 3, 'Hey Zara, watch out for that step!')];
    const result = extractCharacters(cues, 900_000);
    expect(result.map((c) => c.name)).not.toContain('Zara');
  });

  it('excludes stopwords, days, and months even when capitalized mid-sentence', () => {
    const cues = [
      cue(1, 0, 3, "It happened on a Monday in September, and Because it was late, they left."),
      cue(2, 4, 6, 'They said Because they were tired and it was Monday again.')
    ];
    const result = extractCharacters(cues, 900_000);
    const names = result.map((c) => c.name.toLowerCase());
    expect(names).not.toContain('monday');
    expect(names).not.toContain('september');
    expect(names).not.toContain('because');
  });

  it('does not count a capitalized word only because it starts a sentence', () => {
    const cues = [
      cue(1, 0, 3, 'Really? He left already.'),
      cue(2, 4, 6, 'Really? That seems unlikely to me.')
    ];
    const result = extractCharacters(cues, 900_000);
    expect(result.map((c) => c.name)).not.toContain('Really');
  });

  it('is past-only: a name only mentioned after positionMs never appears', () => {
    const cues = sampleStory(); // Carol is first mentioned at 150s
    const result = extractCharacters(cues, 100_000); // before Carol appears
    expect(result.map((c) => c.name)).not.toContain('Carol');
  });

  it('reports firstSeenMs as the earliest mention time', () => {
    const cues = sampleStory();
    const result = extractCharacters(cues, 900_000);
    const carol = result.find((c) => c.name === 'Carol');
    expect(carol?.firstSeenMs).toBe(150_000);
  });

  it('reports mentions >= 2 for repeatedly-named characters', () => {
    const cues = sampleStory();
    const result = extractCharacters(cues, 900_000);
    const alice = result.find((c) => c.name === 'Alice');
    expect(alice && alice.mentions >= 2).toBe(true);
  });

  it('returns results sorted by firstSeenMs', () => {
    const cues = sampleStory();
    const result = extractCharacters(cues, 900_000);
    const times = result.map((c) => c.firstSeenMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
