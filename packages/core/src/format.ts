/**
 * Formats a millisecond offset as a compact timestamp: `"m:ss"` under an
 * hour (e.g. `"12:04"`), `"h:mm:ss"` at or beyond an hour (e.g. `"1:02:03"`).
 * Negative input is clamped to 0.
 */
export function formatTimestamp(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.floor(safeMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${minutes}:${pad(seconds)}`;
}

/**
 * Parses a `"h:mm:ss"`, `"m:ss"`, `"hh:mm:ss.mmm"` or `"mm:ss,mmm"` style
 * timestamp into milliseconds. Returns `null` if the string cannot be
 * parsed as a plausible timestamp. Used by the SRT/VTT parsers and the
 * spoiler guard's future-timestamp check.
 */
export function parseTimestampToMs(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  if (!/^\d{1,2}(:\d{2}){1,2}(\.\d+)?$/.test(cleaned)) {
    return null;
  }
  const [head, fraction] = cleaned.split('.');
  const parts = (head ?? '').split(':').map(Number);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts as [number, number, number];
  } else if (parts.length === 2) {
    [minutes, seconds] = parts as [number, number];
  } else {
    return null;
  }
  const millis = fraction ? Number(`0.${fraction}`) * 1000 : 0;
  if ([hours, minutes, seconds].some((n) => Number.isNaN(n))) {
    return null;
  }
  return Math.round(hours * 3600000 + minutes * 60000 + seconds * 1000 + millis);
}
