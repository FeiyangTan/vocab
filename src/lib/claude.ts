import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '@/db';
import { apiUsage, type Draft } from '@/db/schema';
import { getModel, getPrompt } from '@/db/settings';
import { supportsEffort } from './models';
import { buildUserMessage, CALL_PARAMS, OUTPUT_SCHEMA } from './prompts';

/**
 * 两条会调 Claude 的路径。
 *
 * 🔴 **提示词不在这个文件里了** —— 全部搬到 `src/lib/prompts.ts`，因为它们现在
 * 可以在 `/usage` 页上改，编辑器（客户端组件）要 import 默认值，而这个文件
 * import 了 `@/db`，客户端碰不得。这里只负责「取当前那一份、发出去」。
 */

/**
 * 把这次调用的 token 数记下来，供 `/usage` 页面统计。
 *
 * 🔴 **记录失败绝不能影响主流程** —— 整理明明成功了，却因为写用量表出错而整体
 * 报错，是本末倒置。所以整段吞掉异常，只在服务端日志里留一条。
 *
 * 🔴 **`model` 必须由调用方传进来，不能在这里写死。** 两条路径现在各用各的模型
 *（在 `/usage` 页上选，见 `src/lib/models.ts`），写死的话所有调用都会记到同一个
 * 模型名下，那一页按模型分组的花费估算就是错的 —— 而那正是设置这个功能要看的东西。
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
  /** ios-share / mac / … —— 只是原样带回，模型不用它做判断 */
  source: string;
};

export type ProcessOutput = Draft & { id: number };

export async function draftFromInbox(inputs: ProcessInput[]): Promise<ProcessOutput[]> {
  if (inputs.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const client = new Anthropic({ apiKey });

  const payload = inputs.map((i) => ({ id: i.id, source: i.source, raw_text: i.rawText }));

  // 每次现查，不缓存 —— 在 /usage 页上改完设置，下一次处理就该用新的模型和提示词
  const [model, system] = await Promise.all([getModel('process'), getPrompt('process')]);
  const params = CALL_PARAMS.process;

  const response = await client.messages.create({
    model,
    max_tokens: params.maxTokens,
    system,
    output_config: {
      // 简单抽取任务，不需要默认的 high。
      // 🔴 **按模型条件下发** —— 不支持 effort 的模型（Haiku 4.5）传了会直接 400，
      // 整个调用失败，不是悄悄忽略。
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
 * 给一个词找形近/音近的对比词。
 *
 * `effort: 'low'` + `max_tokens: 500`（见 `prompts.ts` 的 `CALL_PARAMS`）——
 * 这是「给一个词找几个近似词」，不是抽取整段文本，用整理那边的 medium/8000 是浪费。
 *
 * 按次计费，所以只在人点按钮时才发，不做自动补全。
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
      // 同上：不支持 effort 的模型不能传，会 400
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
