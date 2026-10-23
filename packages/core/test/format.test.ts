import { describe, it, expect } from 'vitest';
import { formatTimestamp, parseTimestampToMs } from '../src/format.js';

describe('formatTimestamp', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(4000)).toBe('0:04');
    expect(formatTimestamp(724_000)).toBe('12:04');
    expect(formatTimestamp(3_599_000)).toBe('59:59');
  });

  it('formats hour-plus durations as h:mm:ss', () => {
    expect(formatTimestamp(3_600_000)).toBe('1:00:00');
    expect(formatTimestamp(3_723_000)).toBe('1:02:03');
    expect(formatTimestamp(7_384_000)).toBe('2:03:04');
  });

  it('clamps negative or non-finite input to 0', () => {
    expect(formatTimestamp(-5000)).toBe('0:00');
    expect(formatTimestamp(NaN)).toBe('0:00');
  });
});

describe('parseTimestampToMs', () => {
  it('parses hh:mm:ss and mm:ss forms', () => {
    expect(parseTimestampToMs('1:02:03')).toBe(3_723_000);
    expect(parseTimestampToMs('12:04')).toBe(724_000);
  });

  it('parses fractional seconds with dot or comma', () => {
    expect(parseTimestampToMs('00:00:01.500')).toBe(1500);
    expect(parseTimestampToMs('00:00:01,500')).toBe(1500);
  });

  it('returns null for unparsable strings', () => {
    expect(parseTimestampToMs('not a time')).toBeNull();
    expect(parseTimestampToMs('')).toBeNull();
  });

  it('round-trips through formatTimestamp for whole seconds', () => {
    for (const ms of [0, 4000, 724_000, 3_723_000]) {
      expect(parseTimestampToMs(formatTimestamp(ms))).toBe(ms);
    }
  });
});
