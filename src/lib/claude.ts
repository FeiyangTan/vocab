import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/db';
import { apiUsage, type Draft } from '@/db/schema';
import { getModel, getPrompt } from '@/db/settings';
import { supportsEffort } from './models';
import { buildUserMessage, CALL_PARAMS, OUTPUT_SCHEMA } from './prompts';

/**
 * The two paths that call Claude.
 *
 * 🔴 **The prompts no longer live in this file** — they all moved to `src/lib/prompts.ts`,
 * because they are now editable on `/usage` and the editor (a client component) needs to
 * import the defaults, while this file imports `@/db` and so must never reach the client.
 * All this file does is fetch the current prompt and send it.
 */

/**
 * Record this call's token counts for the `/usage` page.
 *
 * 🔴 **A failed recording must never affect the main flow** — drafting succeeded, and having
 * the whole request fail because writing a usage row errored gets the priorities backwards.
 * So the exception is swallowed entirely, leaving one line in the server log.
 *
 * 🔴 **`model` has to be passed in by the caller, never hardcoded here.** The two paths now
 * use different models (chosen on `/usage`, see `src/lib/models.ts`); hardcoding would record
 * every call under one model name, making that page's per-model spend estimate wrong — which
 * is precisely what the setting exists to let you compare.
 */
async function record(purpose: string, model: string, usage: Anthropic.Usage | undefined) {
  if (!usage) return;
  try {
    await getDb().insert(apiUsage).values({
      purpose,
      model,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    });
  } catch (error) {
    console.error('[usage] failed to record (main flow unaffected):', error);
  }
}

export type ProcessInput = {
  id: number;
  rawText: string;
  /** ios-share / mac / … — passed through verbatim; the model doesn't act on it */
  source: string;
};

export type ProcessOutput = Draft & { id: number };

export async function draftFromInbox(inputs: ProcessInput[]): Promise<ProcessOutput[]> {
  if (inputs.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const client = new Anthropic({ apiKey });

  const payload = inputs.map((i) => ({ id: i.id, source: i.source, raw_text: i.rawText }));

  // Fetched fresh each time, never cached — change a setting on /usage and the next run
  // should already use the new model and prompt
  const [model, system] = await Promise.all([getModel('process'), getPrompt('process')]);
  const params = CALL_PARAMS.process;

  const response = await client.messages.create({
    model,
    max_tokens: params.maxTokens,
    system,
    output_config: {
      // A simple extraction task; the default of high isn't needed.
      // 🔴 **Sent conditionally per model** — a model that doesn't support effort
      // (Haiku 4.5) returns 400 outright and the whole call fails; it is not ignored.
      ...(supportsEffort(model) ? { effort: params.effort } : {}),
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA.process },
    },
    messages: [
      {
        role: 'user',
        content: buildUserMessage.process(inputs.length, JSON.stringify(payload, null, 2)),
      },
    ],
  });

  await record('process', model, response.usage);

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused this request');
  }

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Claude returned no text content');

  const parsed = JSON.parse(text.text) as { items: ProcessOutput[] };
  return parsed.items;
}

/**
 * Find look-alike / sound-alike confusables for one word.
 *
 * `effort: 'low'` + `max_tokens: 500` (see `CALL_PARAMS` in `prompts.ts`) — this is "find a
 * few similar words for one word", not extraction over a block of text, so the drafting
 * path's medium/8000 would be waste.
 *
 * Billed per call, so it only fires when someone presses the button; never on autocomplete.
 */
export async function suggestContrasts(lemma: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const client = new Anthropic({ apiKey });

  const [model, system] = await Promise.all([getModel('contrast'), getPrompt('contrast')]);
  const params = CALL_PARAMS.contrast;

  const response = await client.messages.create({
    model,
    max_tokens: params.maxTokens,
    system,
    output_config: {
      // As above: a model without effort support must not receive it, or it 400s
      ...(supportsEffort(model) ? { effort: params.effort } : {}),
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA.contrast },
    },
    messages: [{ role: 'user', content: buildUserMessage.contrast(lemma) }],
  });

  await record('contrast', model, response.usage);

  if (response.stop_reason === 'refusal') throw new Error('Claude refused this request');

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Claude returned no text content');

  const parsed = JSON.parse(text.text) as { words?: unknown };
  return Array.isArray(parsed.words) ? parsed.words.filter((w): w is string => typeof w === 'string') : [];
}
