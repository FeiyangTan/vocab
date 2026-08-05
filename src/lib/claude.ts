import Anthropic from '@anthropic-ai/sdk';
import type { Draft } from '@/db/schema';

/**
 * 整理阶段：把 inbox 里的原始文本拆成能做成复习卡的五个字段。
 *
 * 产出是**草稿**，不是定论 —— 有一件事 Claude 从原理上就猜不准：
 * 一句话里可能有好几个生僻词，只有 jimmy 知道他当时卡在哪个上。
 * 所以这里只出建议，由审核页做最终决定。
 */

const MODEL = 'claude-opus-5';

export type ProcessInput = {
  id: number;
  rawText: string;
  /** ios-share / mac / … —— 判断 work vs daily 的线索 */
  source: string;
};

export type ProcessOutput = Draft & { id: number };

const SYSTEM = `你在帮一个中文母语者整理他的英语生词本。

他会在阅读时把遇到生词的**整句话**存下来。你的任务是把每条原始文本拆成五个字段，供他复核后做成填空复习卡。

对每一条，输出：

1. **target** —— 目标词在原句里的**实际形态**（原句写 "glancing" 就填 "glancing"，不要改）。
   一句话里可能有好几个词他都不认识；挑**最可能是生词的那一个**（更少见、更学术、更专业的那个）。
   这只是猜测，他会复核后修改，所以宁可选一个明确的，不要含糊。

2. **lemma** —— target 的词形还原（"glancing" → "glance"，"cursory" → "cursory"）。

3. **definition** —— 中文释义，**简短**，只给这个词在**这个语境下**的意思。
   不要给例句（原句本身就是例句），不要罗列该词的其他义项，不要写词性标注。
   多个近义中文词用分号隔开，例如：匆匆的；粗略的

4. **domain** —— "work" 或 "daily"。
   work = 工作、技术、商业、学术语境；daily = 生活、社交、新闻、娱乐语境。
   判断依据首先是句子内容本身。source 字段是次要线索："mac" 多半是他在电脑前工作时遇到的，
   "ios-share" 多半是手机上随便刷到的 —— 但内容和 source 冲突时以内容为准。

5. **cloze** —— **原句原样复制，只把 target 替换成三个下划线 \`___\`**，其余一个字符都不要改
   （标点、大小写、换行全部保留）。

**特殊情况：原始文本只是一个孤立的单词或短语，没有句子。**
这时 cloze 就填那个词本身（不挖空）—— 没有语境可挖。definition 照给，按该词最常见的意思。
这样审核页能直接看出这条缺语境。

**原始文本可能带噪音**（网页分享带过来的标题、URL、多余空白）。忽略噪音，
从中找出那句真正的英文。cloze 基于那句话，不要把 URL 之类的东西复制进去。`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '原样回填输入里的 id' },
          target: { type: 'string' },
          lemma: { type: 'string' },
          definition: { type: 'string' },
          domain: { type: 'string', enum: ['work', 'daily'] },
          cloze: { type: 'string' },
        },
        required: ['id', 'target', 'lemma', 'definition', 'domain', 'cloze'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

export async function draftFromInbox(inputs: ProcessInput[]): Promise<ProcessOutput[]> {
  if (inputs.length === 0) return [];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 未配置');

  const client = new Anthropic({ apiKey });

  const payload = inputs.map((i) => ({ id: i.id, source: i.source, raw_text: i.rawText }));

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    // 简单抽取任务，不需要默认的 high
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content: `处理下面 ${inputs.length} 条，按 id 一一对应返回：\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude 拒绝了这次请求');
  }

  const text = response.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') throw new Error('Claude 没有返回文本内容');

  const parsed = JSON.parse(text.text) as { items: ProcessOutput[] };
  return parsed.items;
}
