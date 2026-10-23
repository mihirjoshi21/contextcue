import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseSrt } from '../src/parse.js';
import { extractCharacters } from '../src/characters.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Regression test built from a ~239-cue excerpt of the REAL, messy
 * ASR-generated subtitle track for `content/subtitles/night-of-the-living-dead-1968.en.srt`
 * (public-domain film, real timestamps preserved) — not synthetic fixtures.
 * It covers the graveyard scene ("Hey, come on, Barb.", "Boys, you'll be
 * damned...", Johnny/Barbara dialogue), the Beakman's Diner mention, the
 * radio/TV broadcast segment (Pittsburgh/Philadelphia, Police, TV), and the
 * "Ben found a television set" / "Mr. Cooper" scene around the 54:34 mark.
 *
 * This is the exact shape of real-world junk that motivated the
 * `extractCharacters` hardening pass: lowercase words leaking in via a
 * case-insensitive vocative regex, interjections ("Jeez", "Boys") and
 * institutional nouns ("Police", "TV") getting swept up as "names", place
 * names (Pittsburgh, Philadelphia) looking like proper nouns, a possessive
 * mangling a place name ("Beakman's"), and "John"/"Johnny" and "Barb"/
 * "Barbara" showing up as separate, undercounted entries instead of being
 * recognized as the same character.
 */
function loadExcerpt() {
  const srt = readFileSync(join(__dirname, 'fixtures', 'notld-excerpt.srt'), 'utf8');
  return parseSrt(srt);
}

describe('extractCharacters on a real, messy ASR subtitle excerpt (Night of the Living Dead, 1968)', () => {
  const cues = loadExcerpt();

  it('reports the real named characters, with nicknames merged into their fuller form', () => {
    const result = extractCharacters(cues, 58 * 60 * 1000);
    const names = result.map((c) => c.name);

    expect(names).toContain('Barbara'); // merged from Barb + Barbara
    expect(names).toContain('Johnny'); // merged from John + Johnny
    expect(names).toContain('Ben'); // first appears at 54:34
    expect(names).toContain('Mr. Cooper'); // honorific kept, not bare "Cooper"

    // Nickname merge means the short forms must NOT also appear standalone.
    expect(names).not.toContain('Barb');
    expect(names).not.toContain('John');
  });

  it('never returns any of the specific junk this excerpt used to produce', () => {
    const result = extractCharacters(cues, 58 * 60 * 1000);
    const names = result.map((c) => c.name);
    const lowerNames = names.map((n) => n.toLowerCase());

    // Lowercase leaks from the old case-insensitive vocative regex.
    expect(lowerNames).not.toContain('heat');
    expect(lowerNames).not.toContain('help');
    // Interjections / generic forms of address.
    expect(names).not.toContain('Boys');
    expect(names).not.toContain('Jeez');
    // All-caps acronym.
    expect(names).not.toContain('TV');
    // Institutional common noun.
    expect(names).not.toContain('Police');
    // Place names (state-capital-adjacent cities mentioned in the broadcast).
    expect(names).not.toContain('Philadelphia');
    expect(names).not.toContain('Pittsburgh');
    // Possessive should never survive un-stripped.
    expect(names).not.toContain("Beakman's");
  });

  it('strips the possessive from a place/name ("Beakman\'s" -> "Beakman")', () => {
    const result = extractCharacters(cues, 58 * 60 * 1000);
    expect(result.map((c) => c.name)).toContain('Beakman');
  });

  it('Ben is past-only: absent before 54:34, present once the cue has played', () => {
    const before = extractCharacters(cues, 50 * 60 * 1000);
    const after = extractCharacters(cues, 58 * 60 * 1000);
    expect(before.map((c) => c.name)).not.toContain('Ben');
    expect(after.map((c) => c.name)).toContain('Ben');
  });

  it('every reported name is capitalized', () => {
    const result = extractCharacters(cues, 58 * 60 * 1000);
    for (const { name } of result) {
      // Allow an "Honorific. Name" prefix (e.g. "Mr. Cooper") — check every
      // space-separated word individually.
      for (const word of name.split(' ')) {
        expect(word[0]).toBe(word[0]?.toUpperCase());
      }
    }
  });

  it('results are sorted by firstSeenMs', () => {
    const result = extractCharacters(cues, 58 * 60 * 1000);
    const times = result.map((c) => c.firstSeenMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
