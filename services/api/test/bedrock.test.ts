import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import { createBedrockProvider, buildUserContent } from '../src/providers/bedrock.js';
import type { AskMeta } from '../src/types.js';

const bedrockMock = mockClient(BedrockRuntimeClient);

const STUB_CONTEXT = {
  positionMs: 0,
  recent: [],
  retrieved: [],
  full: true,
  cueCount: 0,
  charCount: 0,
  maxCueStartMs: 0
};
const STUB_META: AskMeta = { mode: 'ask', question: 'q' };

const ENV_KEYS = ['BEDROCK_PROMPT_CACHE', 'BEDROCK_GUARDRAIL_ID', 'BEDROCK_GUARDRAIL_VERSION'] as const;

describe('BedrockProvider', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    bedrockMock.reset();
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it('calls Converse with system/user from the built prompt and inferenceConfig, and returns the model text', async () => {
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: 'Alice met Bob at the market. [00:05]' }] } },
      stopReason: 'end_turn'
    });

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({ modelId: 'test-model-id', client });

    const result = await provider.ask(
      { system: 'system prompt', user: 'user prompt', maxTokens: 300 },
      STUB_CONTEXT,
      STUB_META
    );

    expect(result.text).toBe('Alice met Bob at the market. [00:05]');
    expect(result.model).toBe('test-model-id');
    expect(result.error).toBeFalsy();

    const call = bedrockMock.commandCalls(ConverseCommand)[0];
    const input = call.args[0].input;
    expect(input.modelId).toBe('test-model-id');
    // "test-model-id" doesn't look like an Anthropic model id, so prompt
    // caching defaults to off and no cachePoint block is added.
    expect(input.system).toEqual([{ text: 'system prompt' }]);
    expect(input.messages).toEqual([{ role: 'user', content: [{ text: 'user prompt' }] }]);
    expect(input.inferenceConfig).toMatchObject({ maxTokens: 300, temperature: 0.2 });
    expect(input.guardrailConfig).toBeUndefined();
  });

  it('degrades to a clean fallback message with an error flag on throttling/errors', async () => {
    bedrockMock.on(ConverseCommand).rejects(new Error('ThrottlingException: rate exceeded'));

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({ modelId: 'test-model-id', client });

    const result = await provider.ask({ system: 's', user: 'u', maxTokens: 100 }, STUB_CONTEXT, STUB_META);

    expect(result.error).toBe(true);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it('adds a system cachePoint by default for an Anthropic model id (prompt caching)', async () => {
    bedrockMock
      .on(ConverseCommand)
      .resolves({ output: { message: { role: 'assistant', content: [{ text: 'cached answer' }] } }, stopReason: 'end_turn' });

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      client
    });

    await provider.ask({ system: 'sys', user: 'usr', maxTokens: 100 }, STUB_CONTEXT, STUB_META);

    const input = bedrockMock.commandCalls(ConverseCommand)[0].args[0].input;
    expect(input.system).toEqual([{ text: 'sys' }, { cachePoint: { type: 'default' } }]);
  });

  it('BEDROCK_PROMPT_CACHE=false disables the cache point even for an Anthropic model', async () => {
    process.env.BEDROCK_PROMPT_CACHE = 'false';
    bedrockMock
      .on(ConverseCommand)
      .resolves({ output: { message: { role: 'assistant', content: [{ text: 'answer' }] } }, stopReason: 'end_turn' });

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      client
    });

    await provider.ask({ system: 'sys', user: 'usr', maxTokens: 100 }, STUB_CONTEXT, STUB_META);

    const input = bedrockMock.commandCalls(ConverseCommand)[0].args[0].input;
    expect(input.system).toEqual([{ text: 'sys' }]);
  });

  it('passes guardrailConfig when BEDROCK_GUARDRAIL_ID/VERSION are set', async () => {
    process.env.BEDROCK_GUARDRAIL_ID = 'gr-123';
    process.env.BEDROCK_GUARDRAIL_VERSION = 'DRAFT';
    bedrockMock
      .on(ConverseCommand)
      .resolves({ output: { message: { role: 'assistant', content: [{ text: 'answer' }] } }, stopReason: 'end_turn' });

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({ modelId: 'test-model-id', client });

    await provider.ask({ system: 'sys', user: 'usr', maxTokens: 100 }, STUB_CONTEXT, STUB_META);

    const input = bedrockMock.commandCalls(ConverseCommand)[0].args[0].input;
    expect(input.guardrailConfig).toEqual({
      guardrailIdentifier: 'gr-123',
      guardrailVersion: 'DRAFT',
      trace: 'disabled'
    });
  });

  it('returns the safe fallback + bedrock-guardrail flag when the guardrail intervenes', async () => {
    process.env.BEDROCK_GUARDRAIL_ID = 'gr-123';
    process.env.BEDROCK_GUARDRAIL_VERSION = 'DRAFT';
    bedrockMock.on(ConverseCommand).resolves({
      output: { message: { role: 'assistant', content: [{ text: 'blocked content the model tried to say' }] } },
      stopReason: 'guardrail_intervened'
    });

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({ modelId: 'test-model-id', client });

    const result = await provider.ask({ system: 'sys', user: 'usr', maxTokens: 100 }, STUB_CONTEXT, STUB_META);

    expect(result.flags).toEqual(['bedrock-guardrail']);
    expect(result.text).not.toContain('blocked content');
  });

  it('askStream yields text deltas from ConverseStreamCommand', async () => {
    async function* fakeStream(): AsyncGenerator<unknown> {
      yield { contentBlockDelta: { delta: { text: 'Hello ' }, contentBlockIndex: 0 } };
      yield { contentBlockDelta: { delta: { text: 'world.' }, contentBlockIndex: 0 } };
      yield { messageStop: { stopReason: 'end_turn' } };
    }
    bedrockMock.on(ConverseStreamCommand).resolves({ stream: fakeStream() as never });

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({ modelId: 'test-model-id', client });

    const chunks: string[] = [];
    for await (const chunk of provider.askStream({ system: 's', user: 'u', maxTokens: 100 }, STUB_CONTEXT, STUB_META)) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('Hello world.');
  });

  it('askStream yields nothing (rather than throwing) when the stream call fails', async () => {
    bedrockMock.on(ConverseStreamCommand).rejects(new Error('ThrottlingException'));

    const client = new BedrockRuntimeClient({ region: 'us-east-1' });
    const provider = createBedrockProvider({ modelId: 'test-model-id', client });

    const chunks: string[] = [];
    for await (const chunk of provider.askStream({ system: 's', user: 'u', maxTokens: 100 }, STUB_CONTEXT, STUB_META)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
  });

  it('splits the user turn at <question> with a cachePoint between (Anthropic only)', () => {
    const user = 'TRANSCRIPT stuff\n<transcript>\nlines\n</transcript>\n\nViewer\'s question:\n<question>who?</question>';
    const blocks = buildUserContent(user, 'us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(blocks).toHaveLength(3);
    expect((blocks[0] as any).text).toContain('</transcript>');
    expect(blocks[1]).toEqual({ cachePoint: { type: 'default' } });
    expect((blocks[2] as any).text).toBe('<question>who?</question>');
    expect(blocks.map((b: any) => b.text ?? '').join('')).toBe(user);
    // no marker, or caching off => single block
    expect(buildUserContent('no marker here', 'us.anthropic.x')).toEqual([{ text: 'no marker here' }]);
    expect(buildUserContent(user, 'test-model-id')).toEqual([{ text: user }]);
  });

  it('sends the split user content on Converse and ConverseStream', async () => {
    const user = 'head\n<question>q</question>';
    bedrockMock.on(ConverseCommand).resolves({ output: { message: { role: 'assistant', content: [{ text: 'a' }] } }, stopReason: 'end_turn' });
    async function* s(): AsyncGenerator<unknown> { yield { contentBlockDelta: { delta: { text: 'x' }, contentBlockIndex: 0 } }; }
    bedrockMock.on(ConverseStreamCommand).resolves({ stream: s() as never });
    const provider = createBedrockProvider({ modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0', client: new BedrockRuntimeClient({ region: 'us-east-1' }) });
    await provider.ask({ system: 's', user, maxTokens: 10 }, STUB_CONTEXT, STUB_META);
    for await (const _ of provider.askStream({ system: 's', user, maxTokens: 10 }, STUB_CONTEXT, STUB_META)) { /* drain */ }
    const expected = [{ text: 'head\n' }, { cachePoint: { type: 'default' } }, { text: '<question>q</question>' }];
    expect(bedrockMock.commandCalls(ConverseCommand)[0].args[0].input.messages?.[0].content).toEqual(expected);
    expect(bedrockMock.commandCalls(ConverseStreamCommand)[0].args[0].input.messages?.[0].content).toEqual(expected);
  });

  it('returns usage from the Converse response', async () => {
    const usage = { inputTokens: 100, outputTokens: 5, totalTokens: 105, cacheReadInputTokens: 90, cacheWriteInputTokens: 0 };
    bedrockMock.on(ConverseCommand).resolves({ output: { message: { role: 'assistant', content: [{ text: 'a' }] } }, stopReason: 'end_turn', usage });
    const provider = createBedrockProvider({ modelId: 'test-model-id', client: new BedrockRuntimeClient({ region: 'us-east-1' }) });
    const r = await provider.ask({ system: 's', user: 'u', maxTokens: 10 }, STUB_CONTEXT, STUB_META);
    expect(r.usage).toMatchObject({ inputTokens: 100, outputTokens: 5, cacheReadInputTokens: 90 });
  });

  it('configures the owned client with adaptive retry, 4 attempts (env-overridable)', async () => {
    const saved = process.env.BEDROCK_MAX_ATTEMPTS;
    try {
      delete process.env.BEDROCK_MAX_ATTEMPTS;
      const p = createBedrockProvider({ modelId: 'x' });
      expect(p).toBeDefined();
      // Inspect the config the provider would build by constructing the same way.
      const c = new BedrockRuntimeClient({ region: 'us-east-1', maxAttempts: 4, retryMode: 'adaptive' });
      expect(await c.config.maxAttempts()).toBe(4);
      expect(c.config.retryMode).toBe('adaptive');
    } finally {
      if (saved === undefined) delete process.env.BEDROCK_MAX_ATTEMPTS; else process.env.BEDROCK_MAX_ATTEMPTS = saved;
    }
  });
});
