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
  /** ios-share / mac / … —— 只是原样带回，模型不用它做判断 */
  source: string;
};

export type ProcessOutput = Draft & { id: number };

const SYSTEM = `你在帮一个中文母语者整理他的英语生词本。

他存进来的可能是**遇到生词的整句话**，也可能只是**一个孤立的单词或短语**。
你的任务是把每条原始文本变成七个字段，供他复核后做成填空复习卡。

先判断这一条属于哪种情况，再按对应规则处理：

## 情况 A：原始文本包含完整句子

- **sentence** —— 从原文里提取出**那一句**。原样复制，一个字符都不要改。
  原始文本常带噪音（网页分享带来的标题、URL、排版折行、多余空白），把噪音去掉，
  只留那句英文本身。
- **generated** —— \`false\`

## 情况 B：原始文本只是一个孤立单词或短语（没有句子）

- **sentence** —— **你来造一个例句**，把这个词自然地用进去。要求：
  - 日常自然的英文，10–20 词
  - **上下文必须让人能推断出这个词的意思** —— 这是填空卡的全部意义。
    造 "I saw a cursory." 这种句子等于没造，因为挖空之后没有任何线索。
    要造 "She gave the contract only a cursory look before signing it." 这种，
    周围的词能撑起词义。
  - 用这个词**最常见**的义项
  - 不要用生僻词堆砌，句子本身不该再制造新的生词
- **generated** —— \`true\`

## 两种情况都要输出的字段

1. **target** —— 目标词在 sentence 里的**实际形态**（句子里写 "glancing" 就填 "glancing"，不要还原）。
   情况 A 下一句话里可能有好几个词他都不认识；挑**最可能是生词的那一个**
   （更少见、更学术、更专业的那个）。这只是猜测，他会复核后修改，
   所以宁可选一个明确的，不要含糊。

2. **lemma** —— target 的词形还原（"glancing" → "glance"，"cursory" → "cursory"）。

3. **definition** —— 中文释义，**简短**，只给这个词在**这个语境下**的意思。
   不要给例句（sentence 本身就是例句），不要罗列其他义项，不要写词性标注。
   多个近义中文词用分号隔开，例如：匆匆的；粗略的

4. **cloze** —— **把 sentence 原样复制，只把 target 替换成三个下划线 \`___\`**，
   其余一个字符都不要改（标点、大小写全部保留）。`;

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
          sentence: { type: 'string', description: '挖空前的完整句子' },
          cloze: { type: 'string' },
          generated: { type: 'boolean', description: 'sentence 是否由你造出来的' },
        },
        required: [
          'id',
          'target',
          'lemma',
          'definition',
          'sentence',
          'cloze',
          'generated',
        ],
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
