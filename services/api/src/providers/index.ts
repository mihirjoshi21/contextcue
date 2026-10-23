import { mockProvider } from './mock.js';
import { createBedrockProvider } from './bedrock.js';
import type { AiProvider } from '../types.js';

export { mockProvider } from './mock.js';
export { createBedrockProvider } from './bedrock.js';

/** Choose a provider from the PROVIDER env var. Defaults to mock (offline-safe). */
export function providerFromEnv(): AiProvider {
  const choice = (process.env.PROVIDER ?? 'mock').toLowerCase();
  if (choice === 'bedrock') return createBedrockProvider();
  return mockProvider;
}
