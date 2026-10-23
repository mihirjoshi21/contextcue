import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/**
 * The TV token is a separate, higher-entropy secret from the 6-character
 * join `code`: the code stays shareable (anyone with it can GET the session
 * or ask questions against it — that's the whole point of a companion
 * flow), but only whoever holds the TV token can PUT (change position/title/
 * playing state) — see SPEC.md's session write-authorization rules.
 */

/** 24 random bytes -> 32 URL-safe base64 chars (well over the 24+ char minimum). */
export function generateTvToken(): string {
  return randomBytes(24).toString('base64url');
}

/** The token is stored hashed (SHA-256, hex), never in plaintext, and the
 * plaintext is returned to the caller exactly once (from `POST /v1/sessions`). */
export function hashTvToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison against a stored hash. Returns false (not a
 * throw) for any missing/malformed input — a session with no token hash yet,
 * or a request with no header, never matches. */
export function verifyTvToken(storedHash: string | undefined, candidateToken: string | undefined): boolean {
  if (!storedHash || !candidateToken) return false;
  const candidateHash = hashTvToken(candidateToken);
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(candidateHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
