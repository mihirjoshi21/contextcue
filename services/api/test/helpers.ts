import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, type AppDeps } from '../src/app.js';
import { FsContentStore } from '../src/store/content.js';
import { InMemorySessionStore } from '../src/store/session-memory.js';
import { mockProvider } from '../src/providers/mock.js';
import { mockSpeech } from '../src/speech/mock.js';
import type { AiProvider } from '../src/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

export function makeTestDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    provider: mockProvider,
    sessionStore: new InMemorySessionStore(),
    contentStore: new FsContentStore(FIXTURES_DIR),
    speech: mockSpeech,
    ...overrides
  };
}

export function makeTestApp(overrides: Partial<AppDeps> = {}) {
  const deps = makeTestDeps(overrides);
  return { app: createApp(deps), deps };
}

/** A provider stub for tests that need to control exactly what the "model" says. */
export function stubProvider(text: string, model = 'stub-model'): AiProvider {
  return {
    name: 'mock',
    model,
    async ask() {
      return { text, model };
    },
    async *askStream() {
      yield text;
    }
  };
}
