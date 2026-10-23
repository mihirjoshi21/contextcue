import { describe, expect, it } from 'vitest';
import { formatTimestamp, spoilerBadgeText, citationSeekMs, sanitizePositionMs, companionUrl } from '../src/format.js';
import { HeartbeatThrottle } from '../src/heartbeat.js';
import { SharedAnswerDeduper } from '../src/sharedAnswer.js';
import { ASK_CHIPS, chipToQuery } from '../src/constants.js';

describe('formatTimestamp', () => {
  it('formats minutes', () => expect(formatTimestamp(724_000)).toBe('12:04'));
  it('formats hours', () => expect(formatTimestamp(3_723_000)).toBe('1:02:03'));
  it('zero', () => expect(formatTimestamp(0)).toBe('0:00'));
  it('floors sub-second', () => expect(formatTimestamp(1999)).toBe('0:01'));
  it('clamps negative and NaN', () => {
    expect(formatTimestamp(-5000)).toBe('0:00');
    expect(formatTimestamp(NaN)).toBe('0:00');
  });
  it('badge text', () => expect(spoilerBadgeText(724_000)).toBe('\u{1F512} Spoiler-safe until 12:04'));
});

describe('seek + position helpers', () => {
  it('seeks 2s before the cited line', () => expect(citationSeekMs(12_000)).toBe(10_000));
  it('never seeks negative', () => expect(citationSeekMs(500)).toBe(0));
  it('handles NaN start', () => expect(citationSeekMs(NaN)).toBe(0));
  it('sanitizes positions', () => {
    expect(sanitizePositionMs(1234.9)).toBe(1234);
    expect(sanitizePositionMs(-1)).toBe(0);
    expect(sanitizePositionMs(Infinity)).toBe(0);
  });
  it('builds companion url, trimming slashes', () => {
    expect(companionUrl('https://x.test//', 'AB12CD')).toBe('https://x.test/companion/?code=AB12CD');
  });
});

describe('HeartbeatThrottle', () => {
  it('sends the first time', () => expect(new HeartbeatThrottle(2000).shouldSend(0, true)).toBe(true));
  it('suppresses within the interval', () => {
    const t = new HeartbeatThrottle(2000);
    t.markSent(0, true);
    expect(t.shouldSend(1999, true)).toBe(false);
  });
  it('sends once the interval elapsed', () => {
    const t = new HeartbeatThrottle(2000);
    t.markSent(0, true);
    expect(t.shouldSend(2000, true)).toBe(true);
  });
  it('sends immediately on pause transition', () => {
    const t = new HeartbeatThrottle(2000);
    t.markSent(0, true);
    expect(t.shouldSend(100, false)).toBe(true);
  });
  it('sends immediately on resume transition', () => {
    const t = new HeartbeatThrottle(2000);
    t.markSent(0, false);
    expect(t.shouldSend(100, true)).toBe(true);
  });
  it('reset forgets history', () => {
    const t = new HeartbeatThrottle(2000);
    t.markSent(0, true);
    t.reset();
    expect(t.shouldSend(1, true)).toBe(true);
  });
});

describe('SharedAnswerDeduper', () => {
  it('handles an id once', () => {
    const d = new SharedAnswerDeduper();
    expect(d.shouldHandle('a')).toBe(true);
    expect(d.shouldHandle('a')).toBe(false);
  });
  it('handles a new id', () => {
    const d = new SharedAnswerDeduper();
    d.shouldHandle('a');
    expect(d.shouldHandle('b')).toBe(true);
  });
  it('ignores null/undefined/empty', () => {
    const d = new SharedAnswerDeduper();
    expect(d.shouldHandle(null)).toBe(false);
    expect(d.shouldHandle(undefined)).toBe(false);
    expect(d.shouldHandle('')).toBe(false);
  });
  it('reset allows the same id again', () => {
    const d = new SharedAnswerDeduper();
    d.shouldHandle('a');
    d.reset();
    expect(d.shouldHandle('a')).toBe(true);
  });
});

describe('chips', () => {
  it('has the 4 Kotlin chips in order', () =>
    expect(ASK_CHIPS.map((c) => c.label)).toEqual(['Catch me up', "Who's who so far", 'What just happened?', 'Why did they do that?']));
  it('maps to tv-source queries', () => expect(chipToQuery(ASK_CHIPS[0])).toMatchObject({ mode: 'recap', source: 'tv' }));
});
