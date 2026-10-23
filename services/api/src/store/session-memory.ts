import { generateSessionCode } from '../ids.js';
import { generateTvToken, hashTvToken } from '../tv-token.js';
import type { CreatedSession, SessionState, SessionStore } from '../types.js';

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionState>();

  async create(): Promise<CreatedSession> {
    let code = generateSessionCode();
    while (this.sessions.has(code)) code = generateSessionCode();
    const tvToken = generateTvToken();
    const state: SessionState = {
      code,
      positionMs: 0,
      playing: false,
      updatedAt: Date.now(),
      tvTokenHash: hashTvToken(tvToken)
    };
    this.sessions.set(code, state);
    return { ...state, tvToken };
  }

  async get(code: string): Promise<SessionState | undefined> {
    return this.sessions.get(code);
  }

  async update(
    code: string,
    patch: Partial<Pick<SessionState, 'titleId' | 'positionMs' | 'playing' | 'sharedAnswer'>>
  ): Promise<SessionState | undefined> {
    const existing = this.sessions.get(code);
    if (!existing) return undefined;
    const updated: SessionState = { ...existing, ...patch, updatedAt: Date.now() };
    this.sessions.set(code, updated);
    return updated;
  }
}
