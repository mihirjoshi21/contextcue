import { CITATION_LEAD_IN_MS } from './constants.js';

/** "12:04" or "1:02:03". Negative / NaN clamp to 0:00. */
export function formatTimestamp(ms: number): string {
  const total = Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function spoilerBadgeText(positionMs: number): string {
  return `\u{1F512} Spoiler-safe until ${formatTimestamp(positionMs)}`;
}

/** Where to seek when a citation is selected: startMs - 2s, never negative. */
export function citationSeekMs(startMs: number): number {
  return Math.max(0, (Number.isFinite(startMs) ? startMs : 0) - CITATION_LEAD_IN_MS);
}

/** Position safe to send to the API: finite, integer, >= 0. */
export function sanitizePositionMs(ms: number): number {
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
}

export function trimTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}

export function companionUrl(apiBaseUrl: string, code: string): string {
  return `${trimTrailingSlashes(apiBaseUrl)}/companion/?code=${encodeURIComponent(code)}`;
}
