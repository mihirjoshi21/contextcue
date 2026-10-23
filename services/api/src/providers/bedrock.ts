import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type GuardrailConfiguration,
  type ContentBlock,
  type SystemContentBlock
} from '@aws-sdk/client-bedrock-runtime';
import { SPOILER_SAFE_FALLBACK } from '@contextcue/core';
import type { AiProvider, AskResult } from '../types.js';

export interface BedrockProviderOptions {
  modelId?: string;
  region?: string;
  client?: BedrockRuntimeClient;
}

const FALLBACK_MESSAGE =
  "I couldn't reach the AI model just now, so I can't answer that safely at the moment. Please try again in a few seconds.";

/**
 * Prompt caching (Converse `cachePoint` blocks) is on by default for Anthropic
 * models — the system prompt (the spoiler-safety rules, which never change
 * per-request) is the cacheable part; the transcript + question live in
 * `user` per SPEC.md, so only `system` gets a cache point here. Toggle with
 * `BEDROCK_PROMPT_CACHE=false` (or `=true` to force it on for a non-Anthropic
 * model too — cache points are ignored by models that don't support them).
 */
function promptCacheEnabled(modelId: string): boolean {
  const envFlag = process.env.BEDROCK_PROMPT_CACHE;
  if (envFlag === 'false') return false;
  if (envFlag === 'true') return true;
  return modelId.toLowerCase().includes('anthropic');
}

function buildSystemBlocks(system: string, modelId: string): SystemContentBlock[] {
  const blocks: SystemContentBlock[] = [{ text: system }];
  if (promptCacheEnabled(modelId)) {
    blocks.push({ cachePoint: { type: 'default' } });
  }
  return blocks;
}

/**
 * Splits the user turn at core's `<question>` marker so the (large, stable) transcript
 * prefix is its own text block followed by a cachePoint; only the short question block
 * after it varies between repeated asks at a similar position. Without the marker (or
 * with caching off) it stays a single text block.
 */
export function buildUserContent(user: string, modelId: string): ContentBlock[] {
  const idx = user.lastIndexOf('<question>');
  if (!promptCacheEnabled(modelId) || idx <= 0) return [{ text: user }];
  const head = user.slice(0, idx);
  const tail = user.slice(idx);
  if (!head.trim() || !tail.trim()) return [{ text: user }];
  return [{ text: head }, { cachePoint: { type: 'default' } }, { text: tail }];
}

function maxAttempts(): number {
  const n = Number(process.env.BEDROCK_MAX_ATTEMPTS);
  return Number.isInteger(n) && n >= 1 ? n : 4;
}

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
};

/** One concise usage line in local dev (never in Lambda, where EMF carries it). */
function logUsage(op: string, usage: Usage | undefined): void {
  if (!usage || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VITEST) return;
  console.log(
    `[bedrock] ${op} usage in=${usage.inputTokens ?? 0} out=${usage.outputTokens ?? 0} ` +
      `cacheRead=${usage.cacheReadInputTokens ?? 0} cacheWrite=${usage.cacheWriteInputTokens ?? 0}`
  );
}

/** Optional Amazon Bedrock Guardrails, wired up only if both env vars are set. */
function guardrailConfigFromEnv(): GuardrailConfiguration | undefined {
  const guardrailIdentifier = process.env.BEDROCK_GUARDRAIL_ID;
  const guardrailVersion = process.env.BEDROCK_GUARDRAIL_VERSION;
  if (!guardrailIdentifier || !guardrailVersion) return undefined;
  return { guardrailIdentifier, guardrailVersion, trace: 'disabled' };
}

/** Logs the error class + message only (never prompt or transcript text). */
function logProviderError(op: string, err: unknown): void {
  const e = err as { name?: string; message?: string };
  console.error(`[bedrock] ${op} failed: ${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`);
}

export function createBedrockProvider(opts: BedrockProviderOptions = {}): AiProvider {
  const modelId =
    opts.modelId ?? process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  const region = opts.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const client = opts.client ?? new BedrockRuntimeClient({ region, maxAttempts: maxAttempts(), retryMode: 'adaptive' });

  return {
    name: 'bedrock',
    model: modelId,

    async ask(built): Promise<AskResult> {
      try {
        const guardrailConfig = guardrailConfigFromEnv();
        const command = new ConverseCommand({
          modelId,
          system: buildSystemBlocks(built.system, modelId),
          messages: [{ role: 'user', content: buildUserContent(built.user, modelId) }],
          inferenceConfig: {
            maxTokens: built.maxTokens,
            temperature: 0.2
          },
          ...(guardrailConfig ? { guardrailConfig } : {})
        });

        const response = await client.send(command);
        const usage = response.usage;
        logUsage('converse', usage);

        if (response.stopReason === 'guardrail_intervened') {
          return { text: SPOILER_SAFE_FALLBACK, model: modelId, flags: ['bedrock-guardrail'] };
        }

        const content = response.output?.message?.content ?? [];
        const text = content
          .map((block) => ('text' in block ? block.text ?? '' : ''))
          .join('')
          .trim();

        if (!text) {
          return { text: FALLBACK_MESSAGE, model: modelId, error: true };
        }

        return { text, model: modelId, usage };
      } catch (err) {
        // Throttling, access-denied, network errors, etc: never let this bubble up
        // as a 500 to the client — degrade to a clean fallback message + error flag.
        logProviderError('converse', err);
        return { text: FALLBACK_MESSAGE, model: modelId, error: true };
      }
    },

    async *askStream(built) {
      try {
        const guardrailConfig = guardrailConfigFromEnv();
        const command = new ConverseStreamCommand({
          modelId,
          system: buildSystemBlocks(built.system, modelId),
          messages: [{ role: 'user', content: buildUserContent(built.user, modelId) }],
          inferenceConfig: {
            maxTokens: built.maxTokens,
            temperature: 0.2
          },
          ...(guardrailConfig ? { guardrailConfig } : {})
        });

        const response = await client.send(command);
        if (!response.stream) return;

        for await (const event of response.stream) {
          if (event.metadata?.usage) logUsage('converse-stream', event.metadata.usage);
          const delta = event.contentBlockDelta?.delta;
          if (delta && 'text' in delta && delta.text) {
            yield delta.text;
          }
          // Note: a guardrail intervening mid-stream surfaces as a
          // `messageStop.stopReason === 'guardrail_intervened'` event with no
          // further text — the per-sentence `spoilerGuard` pass the caller
          // (src/ask.ts) already runs on every completed sentence is the
          // safety net for streamed output, so no special-casing is needed
          // here beyond simply not yielding anything more.
        }
      } catch (err) {
        logProviderError('converse-stream', err);
        // Swallow: an empty/aborted stream reads as "no content" upstream,
        // which resolves to the shared safe-fallback answer.
      }
    }
  };
}
