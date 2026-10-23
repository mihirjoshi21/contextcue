import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import type { Speech, SpeechResult } from '../types.js';

export interface PollySpeechOptions {
  region?: string;
  defaultVoice?: string;
  client?: PollyClient;
}

async function streamToBase64(stream: unknown): Promise<string> {
  // AWS SDK v3 returns a Node Readable in Node runtimes, or a web ReadableStream
  // in some environments (e.g. Lambda web streams). Handle both.
  if (stream && typeof (stream as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike));
    }
    return Buffer.concat(chunks).toString('base64');
  }
  throw new Error('Unsupported Polly audio stream type');
}

export function createPollySpeech(opts: PollySpeechOptions = {}): Speech {
  const region = opts.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const defaultVoice = opts.defaultVoice ?? 'Joanna';
  const client = opts.client ?? new PollyClient({ region });

  return {
    name: 'polly',
    async synthesize(text: string, voice?: string): Promise<SpeechResult> {
      try {
        const command = new SynthesizeSpeechCommand({
          Text: text,
          VoiceId: (voice ?? defaultVoice) as SynthesizeSpeechCommand['input']['VoiceId'],
          Engine: 'neural',
          OutputFormat: 'mp3'
        });
        const response = await client.send(command);
        if (!response.AudioStream) {
          return { audioBase64: '', contentType: 'audio/mpeg', error: true };
        }
        const audioBase64 = await streamToBase64(response.AudioStream);
        return { audioBase64, contentType: 'audio/mpeg' };
      } catch {
        return { audioBase64: '', contentType: 'audio/mpeg', error: true };
      }
    }
  };
}
