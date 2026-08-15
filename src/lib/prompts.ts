import type { Purpose } from './models';

/**
 * 全站发给 Claude 的**所有**提示词，集中在这一个文件里。
 *
 * 分成三层，只有第一层能在 `/usage` 页上改：
 *
 * | 层 | 内容 | 能不能改 |
 * |---|---|---|
 * | system | 下面两段 `DEFAULT_PROMPT` | **能** —— 改动存 `settings` 表，覆盖这里的默认值 |
 * | user | `buildUserMessage` | 只读 —— 它是数据信封（`{n}` 条 JSON、`{lemma}`），不是指令 |
 * | 结构化输出 | `OUTPUT_SCHEMA` | 只读 —— 字段名和 `Draft` 类型、数据库列一一对应，改了整条链路对不上 |
 *
 * 🔴 **这个文件必须保持「客户端安全」**（同 `src/lib/models.ts`）—— `/usage` 页那个
 * `'use client'` 的提示词编辑器要 import 默认值来做「恢复默认」和「改过没有」的判断。
 * 一旦在这儿 import `@/db`，drizzle 和 Neon 驱动就会被打进浏览器包，
 * 实测会让 Vercel 构建直接失败（本地 `next build` 反而能过，看本地是发现不了的）。
 * 读写库的部分在 `src/db/settings.ts`。
 */

/**
 * 整理阶段的 system prompt：把 inbox 里的原始文本拆成能做成复习卡的字段。
 *
 * 产出是**草稿**，不是定论 —— 有一件事 Claude 从原理上就猜不准：
 * 一句话里可能有好几个生僻词，只有 jimmy 知道他当时卡在哪个上。
 * 所以这里只出建议，由审核页做最终决定。
 */
const PROCESS_SYSTEM = `你在帮一个中文母语者整理他的英语生词本。

他存进来的东西有三种形态：**完整的句子**、**半截话**（不成句）、**孤立的单词或短语**。
你的任务是把每条原始文本变成七个字段，供他复核后做成填空复习卡。

先判断这一条属于哪种情况，再按对应规则处理：

## 情况 A：原始文本包含完整句子

- **sentence** —— 从原文里提取出**那一句**。
  原始文本常带噪音（网页分享带来的标题、URL、排版折行、多余空白），把噪音去掉，
  只留那句英文本身。

  **可以改明显的错误**：拼写错、时态 / 单复数 / 冠词 / 介词这类语法错、明显的标点错。
  他常常是手打或 OCR 进来的，带着错原样做成卡片，等于把错的用法背下来。

  🔴 **只改错，不改写。** 不润色、不换更「好」的词、不调语序、不改长短。
  他遇到的就是那一句，改多了就不是他的语境了。
  **拿不准是不是错误就不要动** —— 少改一处没损失，误改一处他很难发现。

- **generated** —— \`false\`（句子是他自己的，你只是清了噪音、顺手改了错）

## 情况 B：原始文本是半截话（有上下文但不成句）

比如 "the reading experience is crisp and"、"gave it only a cursory"、
被截断或缺主谓的片段。判断标准是：**它带着语境，但不是一个完整的句子。**

- **sentence** —— **把它补成一个完整、自然的句子**。
  🔴 **原有的词尽量原样留下、顺序不变** —— 那半句才是他真正遇到的东西，
  你补的部分只是把它撑成一句话。能只在前后加几个词就成句，就别重写中间。
  同时按情况 A 的标准把里面的**明显错误改对**。
  补完之后同样要满足：上下文能让人推断出目标词的意思。

- **generated** —— \`true\`（成句是你补的，不是他原样遇到的）

## 情况 C：原始文本只是一个孤立单词或短语（没有任何语境）

- **sentence** —— **你来造一个例句**，把这个词自然地用进去。要求：
  - 日常自然的英文，10–20 词
  - **上下文必须让人能推断出这个词的意思** —— 这是填空卡的全部意义。
    造 "I saw a cursory." 这种句子等于没造，因为挖空之后没有任何线索。
    要造 "She gave the contract only a cursory look before signing it." 这种，
    周围的词能撑起词义。
  - 用这个词**最常见**的义项
  - 不要用生僻词堆砌，句子本身不该再制造新的生词
- **generated** —— \`true\`

## 三种情况都要输出的字段

1. **target** —— 目标词在 sentence 里的**实际形态**（句子里写 "glancing" 就填 "glancing"，不要还原）。
   🔴 是在**最终的 sentence 里**的形态 —— 你改过错、补过句之后的那一版，不是原始输入。
   情况 A / B 下一句话里可能有好几个词他都不认识；挑**最可能是生词的那一个**
   （更少见、更学术、更专业的那个）。情况 B 里优先从**他原本就写了的那半句**里挑 ——
   你补上去的词不是他的生词。这只是猜测，他会复核后修改，
   所以宁可选一个明确的，不要含糊。

2. **lemma** —— target 的词形还原（"glancing" → "glance"，"cursory" → "cursory"）。

3. **definition** —— 中文释义，**简短**，只给这个词在**这个语境下**的意思。
   不要给例句（sentence 本身就是例句），不要罗列其他义项。
   多个近义中文词用分号隔开，例如：匆匆的；粗略的

4. **pos** —— 词性简写。
   🔴 **按这个词在这句话里的实际用法判定，不是列出词典里的所有词性。**
   avalanche 在「雪崩埋了那条路」里就是 n.，不要写成 n./vi./vt.
   可用：n. / v. / a. / ad. / prep. / conj. / pron. / int. / num. / art.
   （及物不及物不用分，一律 v.；形容词一律 a.，副词一律 ad.）
   拿不准就给空字符串，别硬猜。

5. **cloze** —— **把 sentence 原样复制，只把 target 替换成三个下划线 \`___\`**，
   其余一个字符都不要改（标点、大小写全部保留）。

   🔴 **复制的是你最终输出的那个 sentence**，不是原始输入 —— 你改了错、补了句，
   cloze 就得跟着那一版走。复习页正是靠「cloze 和 sentence 只差 target 这一处」
   去定位句子里该高亮哪一段的；差一个字符，高亮就整个失效。`;

/** 对比词那条路径的 system prompt */
const CONTRAST_SYSTEM = `你在帮一个**中文母语者**整理英语生词本的「对比词」。

给你一个目标词，找出**他容易和它搞混**的英文词。三类：

1. **拼写相近** —— altar / alter，desert / dessert
2. **同音** —— their / there，bare / bear
3. **发音容易混淆** —— 中文母语者常栽的那些（thin / sin，rice / lice，vest / west）

硬性要求：

- **必须是真实存在的英文词**，不许生造
- **只能是常用词** —— 大致在雅思词汇范围内。生僻词、俚语、专有名词、缩写一律不要：
  拿生僻词当对比词毫无意义，他根本不会把一个没见过的词和这个词搞混
- **不要包含目标词本身**
- **不要它的屈折变化**（brew / brewing / brewed 是同一个词，不构成混淆）
- 最多 4 个
- 🔴 **宁缺毋滥** —— 找不到像样的就**返回空数组**。凑数的对比词只会在复习时制造噪音。`;

/**
 * 出厂的 system prompt。
 *
 * 🔴 **这是「默认值」不是「当前值」。** 在 `/usage` 页改过之后，真正发出去的是
 * `settings` 表里那一份（见 `getPrompt`）；改回默认是**删掉那一行**，不是把这段
 * 文本写进库 —— 这样以后我在代码里改进了默认提示词，没动过的那条能自动跟上。
 */
export const DEFAULT_PROMPT: Record<Purpose, string> = {
  process: PROCESS_SYSTEM,
  contrast: CONTRAST_SYSTEM,
};

/**
 * user 消息 —— **不可编辑**，它是数据信封不是指令。
 *
 * 下面的 `USER_TEMPLATE` 是**用这两个函数生成的**，不是另抄一份：抄一份的话
 * 代码改了、页面上展示的还是旧的，而那种不一致恰恰最难发现。
 */
export const buildUserMessage = {
  process: (count: string | number, payload: string) =>
    `处理下面 ${count} 条，按 id 一一对应返回：\n\n${payload}`,
  contrast: (lemma: string) => `目标词：${lemma}`,
};

/** 页面上展示用的 user 消息形状，占位符代替真实数据 */
export const USER_TEMPLATE: Record<Purpose, string> = {
  process: buildUserMessage.process('{n}', '[{ "id": …, "source": …, "raw_text": … }, …]'),
  contrast: buildUserMessage.contrast('{lemma}'),
};

const PROCESS_SCHEMA = {
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
          pos: { type: 'string', description: '词性简写，按这句话里的用法；拿不准给空串' },
          sentence: { type: 'string', description: '挖空前的完整句子' },
          cloze: { type: 'string' },
          generated: {
            type: 'boolean',
            description:
              'sentence 是不是他原样遇到的。完整句（哪怕改了错别字）给 false；' +
              '半截话补成的、或整句由你造的，给 true',
          },
        },
        required: [
          'id',
          'target',
          'lemma',
          'definition',
          'pos',
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

const CONTRAST_SCHEMA = {
  type: 'object',
  properties: {
    words: {
      type: 'array',
      items: { type: 'string' },
      description: '容易和目标词搞混的英文词，最多 4 个；没有就给空数组',
    },
  },
  required: ['words'],
  additionalProperties: false,
} as const;

/**
 * 结构化输出的 JSON Schema —— **不可编辑**。
 *
 * 字段名和 `Draft` 类型、审核页、数据库列是一一对应的；改一个名字，模型照改，
 * 然后审核页拿到一堆 undefined。它是接口契约，不是提示词。
 */
export const OUTPUT_SCHEMA = {
  process: PROCESS_SCHEMA,
  contrast: CONTRAST_SCHEMA,
} as const;

/** 调用参数，页面上一并显示 —— 「到底发出去了什么」应该在一处看全 */
export const CALL_PARAMS: Record<Purpose, { maxTokens: number; effort: 'low' | 'medium' }> = {
  process: { maxTokens: 8000, effort: 'medium' },
  contrast: { maxTokens: 500, effort: 'low' },
};

/**
 * 提示词长度上限。
 *
 * 不是模型的限制（它能吃下多得多），是**防手滑** —— 整页粘贴进去、或者脚本
 * 死循环写入这种。system prompt 每次调用都全量发送，越长越贵。
 */
export const MAX_PROMPT_LENGTH = 20_000;

/**
 * 存之前挡一道。返回错误文案，`null` 表示通过。
 *
 * 🔴 **空提示词必须挡住**。传空字符串给 API 不会报错，模型只会在没有任何指令的
 * 情况下自由发挥 —— 整理出来的东西看着像那么回事，字段却对不上，
 * 而且要等到审核页才发现。想回到出厂设置用「恢复默认」，不是清空。
 */
export function validatePrompt(value: unknown): string | null {
  if (typeof value !== 'string') return 'The prompt must be a string';
  if (value.trim().length === 0) return 'The prompt cannot be empty — use Reset to default instead';
  if (value.length > MAX_PROMPT_LENGTH) {
    return `The prompt is too long (${value.length} / ${MAX_PROMPT_LENGTH} characters)`;
  }
  return null;
}
