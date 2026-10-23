import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { providerFromEnv } from './providers/index.js';
import { InMemorySessionStore } from './store/session-memory.js';
import { DynamoSessionStore } from './store/session-dynamo.js';
import { contentStoreFromEnv } from './store/content.js';
import { mockSpeech } from './speech/mock.js';
import { createPollySpeech } from './speech/polly.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/api/src/local.ts -> apps/companion/dist is 3 levels up from services/api.
const companionDist = path.resolve(__dirname, '../../../apps/companion/dist');

const sessionStore = process.env.SESSIONS_TABLE ? new DynamoSessionStore() : new InMemorySessionStore();
const speech = (process.env.SPEECH ?? 'mock') === 'polly' ? createPollySpeech() : mockSpeech;

const app = createApp({
  provider: providerFromEnv(),
  sessionStore,
  contentStore: contentStoreFromEnv(),
  speech
});

if (existsSync(companionDist)) {
  app.use(
    '/companion/*',
    serveStatic({
      root: companionDist,
      rewriteRequestPath: (p) => p.replace(/^\/companion/, '') || '/index.html'
    })
  );
  console.log(`Serving companion app from ${companionDist} at /companion`);
} else {
  console.log(`No companion build found at ${companionDist} (run "npm run build -w companion" to enable /companion)`);
}

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`ContextCue API listening on http://localhost:${info.port}`);
  console.log(`  provider: ${process.env.PROVIDER ?? 'mock'}`);
  console.log(`  MCP endpoint: http://localhost:${info.port}/mcp`);
});
