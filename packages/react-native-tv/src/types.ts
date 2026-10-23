/** Wire + UI types. Mirrors SPEC.md "HTTP API". */

export type AskMode = 'ask' | 'recap' | 'who' | 'scene';

export interface Citation {
  startMs: number;
  endMs: number;
  text: string;
}

export interface SharedAnswer {
  id: string;
  question: string;
  answer: string;
  citations: Citation[];
  mode?: AskMode | string;
  createdAt?: number;
}

export interface SessionState {
  code: string;
  titleId?: string;
  positionMs: number;
  playing: boolean;
  updatedAt?: number;
  sharedAnswer?: SharedAnswer;
}

export interface CreatedSession {
  code: string;
  tvToken: string;
}

export interface AskRequest {
  titleId: string;
  positionMs: number;
  question?: string;
  mode?: AskMode;
  sessionCode?: string;
  audience?: 'adult' | 'kids';
  locale?: string;
  showOnTv?: boolean;
}

export interface AskResponse {
  answer: string;
  mode: AskMode;
  citations: Citation[];
  safeUntilMs: number;
  guard: { passed: boolean; flags: string[] };
  provider: string;
  model: string;
  latencyMs: number;
}

export interface SpeakResponse {
  audioBase64: string;
  contentType: string;
  error?: boolean;
  mock?: boolean;
  flags?: string[];
}

/** A resolved question: a fixed chip, a typed question, or one mirrored from the phone. */
export interface AskQuery {
  label: string;
  mode: AskMode;
  question: string;
  source: 'tv' | 'phone';
}
