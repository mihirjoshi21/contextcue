import type { Speech, SpeechResult } from '../types.js';

/** MockSpeech: no AWS creds needed. Returns an empty payload with an error flag. */
export const mockSpeech: Speech = {
  name: 'mock',
  async synthesize(): Promise<SpeechResult> {
    return { audioBase64: '', contentType: 'audio/mpeg', error: true };
  }
};
