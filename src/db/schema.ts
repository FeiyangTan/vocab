import {
  bigint,
  bigserial,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * 核心实体是「我遇到它的那一次」（encounter），不是「单词」。
 * 同一个词在技术文档里遇到一次、在闲聊里遇到一次 = 两条 encounter、两张卡，各带各的原句。
 * 所以 cards 挂在 encounters 上，不挂在 words 上。
 */

export const inboxStatus = pgEnum('inbox_status', ['pending', 'processed', 'discarded']);
export const wordDomain = pgEnum('word_domain', ['work', 'daily']);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** 捕获落点。捕获阶段只写 raw_text 和 source，不做任何加工 —— 3 秒结束。 */
export const inbox = pgTable(
  'inbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rawText: text('raw_text').notNull(),
    source: text('source').notNull(),
    status: inboxStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
  },
  (t) => [index('inbox_status_created_at_idx').on(t.status, t.createdAt)],
);

export const words = pgTable(
  'words',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    lemma: text('lemma').notNull(),
    /** 复习队列按 domain 分开 */
    domain: wordDomain('domain').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('words_lemma_idx').on(t.lemma)],
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
