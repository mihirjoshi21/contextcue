import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { providerFromEnv } from './providers/index.js';
import { DynamoSessionStore } from './store/session-dynamo.js';
import { contentStoreFromEnv } from './store/content.js';
import { mockSpeech } from './speech/mock.js';
import { createPollySpeech } from './speech/polly.js';

// Lambda is always backed by DynamoDB for sessions (no in-process memory to share
// across invocations) and by S3 or the bundled /content dir for content.
const sessionStore = new DynamoSessionStore();
const speech = (process.env.SPEECH ?? 'polly') === 'polly' ? createPollySpeech() : mockSpeech;

const app = createApp({
  provider: providerFromEnv(),
  sessionStore,
  contentStore: contentStoreFromEnv(),
  speech
});

export const handler = handle(app);
