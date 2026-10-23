import type { AskMode, AskQuery } from './types.js';

/** Single place to rename the product. */
export const PRODUCT_NAME = 'ContextCue';

export const HEARTBEAT_INTERVAL_MS = 2000;
export const SHARED_ANSWER_POLL_INTERVAL_MS = 2000;
/** How far before a cited line we seek, so the viewer hears the line start (matches Kotlin app). */
export const CITATION_LEAD_IN_MS = 2000;

export interface AskChipDef {
  id: string;
  label: string;
  mode: AskMode;
  question: string;
}

/** Same chips, order and wording as the Kotlin Fire TV app. */
export const ASK_CHIPS: readonly AskChipDef[] = [
  { id: 'recap', label: 'Catch me up', mode: 'recap', question: "Catch me up on everything that's happened so far." },
  { id: 'who', label: "Who's who so far", mode: 'who', question: "Who's who so far?" },
  { id: 'scene', label: 'What just happened?', mode: 'scene', question: 'What just happened in this scene?' },
  { id: 'why', label: 'Why did they do that?', mode: 'ask', question: 'Why did they do that?' },
];

export function chipToQuery(chip: AskChipDef): AskQuery {
  return { label: chip.label, mode: chip.mode, question: chip.question, source: 'tv' };
}
