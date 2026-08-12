import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * 核心实体是「我遇到它的那一次」（encounter），不是「单词」。
 * 同一个词在技术文档里遇到一次、在闲聊里遇到一次 = 两条 encounter、两张卡，各带各的原句。
 * 所以 cards 挂在 encounters 上，不挂在 words 上。
 */

export const inboxStatus = pgEnum('inbox_status', ['pending', 'processed', 'discarded']);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Claude 预处理的产出。**只是草稿** —— 人确认之前不写 words/encounters/cards。
 *
 * 为什么不直接写库：cards 和 inbox 之间没有外键，复习队列查询排除不掉「还没审核的卡」。
 * 如果 process 直接落库，Claude 切错词的卡会立刻混进复习。
 */
export type Draft = {
  /** 目标词在句子里的实际形态 */
  target: string;
  /** 词形还原 */
  lemma: string;
  /** 中文释义 */
  definition: string;
  /** 词性简写，按这句话里的实际用法（`n.` / `v.` / `a.` …）。给不出就空串 */
  pos: string;
  /**
   * `carve (cave)` 这种写法里括号中的对比词。
   *
   * 整理阶段的 prompt **不产出**对比词 —— 那一步是从原文抽字段。
   * 这里只是把人在捕获时就顺手写下的那几个带到审核页去，省得再敲一遍。
   */
  contrasts: string[];
  /** 手写备注，随确认一起提交。AI 不产出这个字段 */
  remark: string | null;
  /** cloze 挖空前的完整句子 */
  sentence: string;
  /** sentence 挖掉目标词，用 ___ 占位 */
  cloze: string;
  /**
   * true = 这句是 Claude 造的，不是 jimmy 真遇到的语境。
   *
   * 存进去的是孤立单词时没语境可挖，只能造一句。但造句**不等价于**真实语境 ——
   * 文档的核心设计说得很清楚，价值来自「我遇到它的那一次」。所以这个标记要一路
   * 传到审核页显示出来，让人分得清哪些卡有真语境。
   */
  generated: boolean;
};

/**
 * 复习队列按分类分开。原来是写死的 work/daily 枚举，现在由人自己增删改。
 *
 * **Claude 不碰分类** —— 归类是个人化的判断（同一个词对不同人属于不同场景），
 * 让模型猜只会制造要人回头改的噪音。审核时默认选中 isDefault 那个，要改就点。
 */
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** 列表和审核页按钮的顺序 */
  sortOrder: integer('sort_order').notNull().default(0),
  /** 审核页默认选中哪个。全表**恰好一个** true，靠事务保证 */
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});

/** 捕获落点。捕获阶段只写 raw_text 和 source，不做任何加工 —— 3 秒结束。 */
export const inbox = pgTable(
  'inbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rawText: text('raw_text').notNull(),
    source: text('source').notNull(),
    status: inboxStatus('status').notNull().default('pending'),
    /** null = 还没被 Claude 处理过 */
    draft: jsonb('draft').$type<Draft>(),
    /**
     * 存入时就指定的分类。**可空** —— iOS 快捷指令那条链路不传，
     * 审核页遇到 null 就退回默认分类。
     *
     * `onDelete: 'set null'` 而不是 `restrict`：待办条目挡住删分类太意外了
     * （词有归属是硬要求，一条还没审核的原始文本没有）。
     */
    categoryId: integer('category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('inbox_status_created_at_idx').on(t.status, t.createdAt)],
);

export const words = pgTable(
  'words',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    lemma: text('lemma').notNull(),
    /**
     * 复习队列按分类分开。
     *
     * `onDelete: 'restrict'` 是**故意**的：分类里还有词就不许删，得先把词转走。
     * 应用层会先查计数给出友好提示，但库层这道也要有 —— 代码出 bug 时，
     * 词不能跟着分类一起无声消失。
     */
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /**
     * 对比词：拼写或读音相近、容易记混的词（cursory / cursor / courtesy）。
     *
     * 挂在 word 而不是 encounter 上，因为混淆是词本身的属性，同一个词的多次
     * encounter 应该共享同一组对比词。
     *
     * 两个来源：手动敲，或点「AI 匹配」让 Claude 找形近/音近的词
     *（`POST /api/words/{id}/contrasts/suggest`）。两者**合并不覆盖** ——
     * 手动加的是自己栽过跟头才记下的，不能被模型的建议冲掉。
     */
    contrasts: jsonb('contrasts').$type<string[]>().notNull().default([]),
    /**
     * 手写备注。**纯人工，AI 不碰** —— 和对比词一样，这是只有本人知道的东西：
     * 这个词为什么难记、在哪儿见过、老板邮件里怎么用的。
     *
     * 挂在 word 不挂在 encounter：备注是对「这个词」的注解，同一个词的多次
     * encounter 应该共享它。可空 —— 没写过和写了空串是一回事。
     *
     * 叫 remark 不叫 note：`encounters.note` 已经是「释义」了，
     * 同一个仓库里两个 note 指两样东西，迟早看错。
     */
    remark: text('remark'),
    /**
     * 手动排序用。初始值按 lemma 字母序回填，所以不拖的话看上去和以前一样。
     * 新确认的词取所在分类的 `max+1`，落到末尾（默认 0 会排到最前，不对）。
     */
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * 词频指标（Zipf，见 `src/lib/frequency.ts`）。**可空** —— null 是
     *「SUBTLEX 里没收录」（词组、专名），和「频率为 0」不是一回事。
     */
    zipf: real('zipf'),
    /**
     * 「快速过词」本轮已经标过「认识」，出队。一轮结束时整批置回 false。
     *
     * 和 `cards` 的复习进度**完全无关** —— 快速过词是按词频把整个分类刷一遍的
     * 分拣动作，挖空复习是间隔重复，两套各走各的，互相不写对方的字段。
     */
    triageDone: boolean('triage_done').notNull().default(false),
    /**
     * 「快速过词」本轮的队列位置。**null = 不在任何一轮里**。
     *
     * 开一轮时按词频序打成 1,2,3…（口径同 `/api/words/reorder-by-frequency`）。
     * 标「不认识」时插到后面第 10、11 位之间 —— 所以是 double precision 不是
     * integer，整数之间得塞得下值。
     *
     * 不复用 `sortOrder`：那是你手动拖出来的顺序，这一轮的队列会被「不认识」
     * 反复打乱，两者混在一列里，退出这个模式之后词汇页的顺序就毁了。
     */
    triageOrder: doublePrecision('triage_order'),
    createdAt: createdAt(),
  },
  (t) => [
    index('words_lemma_idx').on(t.lemma),
    /*
     * 「同一个 lemma 在同一分类下只有一条 word」原来只写在注释里，靠应用层
     * 「先查再插」保证 —— 并发时两个请求会同时查到「不存在」，各插一条。
     * 批量确认要在一个事务里靠 lemma 把 `RETURNING` 的结果对回去，
     * 这条唯一性必须是**数据库保证**才成立。
     */
    uniqueIndex('words_lemma_category_idx').on(t.lemma, t.categoryId),
  ],
);

/** 一个 word 对多个 encounter。 */
export const encounters = pgTable(
  'encounters',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    wordId: bigint('word_id', { mode: 'number' })
      .notNull()
      .references(() => words.id, { onDelete: 'cascade' }),
    rawText: text('raw_text').notNull(),
    source: text('source').notNull(),
    note: text('note'),
    /**
     * 词性，按**这一次的语境**判定（`n.` / `v.` / `a.` …）。
     *
     * 和 `note` 同一层，都随语境走 —— `tear` 在一句里是 n. 眼泪、另一句里是
     * v. 撕破。不查词典是因为词典给的是全部义项：221 个词里 57% 有 2 个以上词性，
     * 贴上去一半以上是噪音。Claude 看得到句子，知道这里用的是哪个。
     */
    pos: text('pos'),
    createdAt: createdAt(),
  },
  (t) => [index('encounters_word_id_idx').on(t.wordId)],
);

/** 复习卡。cloze = 挖空原句，不是「英文 → 中文」。ease/interval/reps 是 SM-2 的状态。 */
export const cards = pgTable(
  'cards',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    encounterId: bigint('encounter_id', { mode: 'number' })
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    clozeText: text('cloze_text').notNull(),
    due: timestamp('due', { withTimezone: true }).notNull().defaultNow(),
    ease: real('ease').notNull().default(2.5),
    /** 间隔天数 */
    interval: integer('interval').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // 复习队列按 due 查，这个索引是热路径
    index('cards_due_idx').on(t.due),
    index('cards_encounter_id_idx').on(t.encounterId),
  ],
);

/**
 * Claude API 的用量记录，一次调用一行。
 *
 * SDK 每次响应里都带 `usage`，以前直接丢掉了。落库之后 `/usage` 页面就能按用途和
 * 按天看，**零额外成本、不需要新密钥**。
 *
 * 为什么不按天聚合：行数很小（一天几十次撑死），留着明细才能按用途拆，
 * 以后想加维度也不用改历史数据。
 *
 * 🔴 **不存金额** —— 单价会变，硬编码算出来的「花了多少钱」是假精确。
 * 顺带一提，Anthropic **没有**查余额的接口（Admin API 只有用量和已花费，
 * 而且对个人账号不开放），所以「还剩多少」只能去 Console 看。
 */
export const apiUsage = pgTable(
  'api_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** 干什么用的：process（整理草稿）/ contrast（AI 匹配对比词） */
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** 缓存命中的输入 token —— 计价比普通输入便宜得多，分开记才看得出优化效果 */
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('api_usage_created_at_idx').on(t.createdAt)],
);
