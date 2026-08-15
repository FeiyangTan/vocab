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
 * The core entity is "the time I ran into it" (an encounter), not "the word".
 * Meeting the same word once in a technical document and once in small talk = two encounters
 * and two cards, each with its own original sentence.
 * That's why cards hang off encounters, not off words.
 */

export const inboxStatus = pgEnum('inbox_status', ['pending', 'processed', 'discarded']);

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * What Claude's preprocessing produces. **A draft only** — nothing is written to
 * words/encounters/cards until a human confirms.
 *
 * Why not write straight to the database: there is no foreign key between cards and inbox, so
 * the review-queue query has no way to exclude "cards not yet reviewed". If processing wrote
 * directly, a card where Claude picked the wrong word would immediately enter review.
 */
export type Draft = {
  /** The target word's actual surface form in the sentence */
  target: string;
  /** Lemmatised form */
  lemma: string;
  /** The Chinese definition */
  definition: string;
  /** Part of speech, abbreviated, for how it's used in *this* sentence
   *  (`n.` / `v.` / `a.` …). Empty string when it can't be determined */
  pos: string;
  /**
   * The confusables from inside the parentheses of the `carve (cave)` shorthand.
   *
   * The drafting prompt **does not produce** confusables — that step extracts fields from the
   * original text. This just carries whatever was typed at capture time through to the review
   * page, so it doesn't have to be retyped.
   */
  contrasts: string[];
  /** A hand-written note, submitted along with the confirmation. The AI never fills this */
  remark: string | null;
  /** The complete sentence, before the cloze blank is cut */
  sentence: string;
  /** The sentence with the target word replaced by ___ */
  cloze: string;
  /**
   * true = Claude invented this sentence; it isn't a context jimmy actually met.
   *
   * When the input is an isolated word there is no context to work from, so a sentence has to
   * be made up. But an invented sentence is **not equivalent** to a real one — the core design
   * is explicit that the value comes from "the time I ran into it". So this flag travels all
   * the way to the review page and is displayed, to keep real contexts distinguishable.
   */
  generated: boolean;
};

/**
 * Review queues are split by category. This used to be a hardcoded work/daily enum; now the
 * categories are created, renamed, and deleted by hand.
 *
 * **Claude never touches categories** — filing something is a personal judgement (the same
 * word belongs to different situations for different people), and having the model guess only
 * creates noise someone has to go back and fix. Review preselects the isDefault one; changing
 * it is one tap.
 */
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  /** Order in the list and among the review page's buttons */
  sortOrder: integer('sort_order').notNull().default(0),
  /** Which one the review page preselects. **Exactly one** row is true, held by transaction */
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
});

/** Where captures land. Capture writes only raw_text and source, with no processing at
 *  all — three seconds and done. */
export const inbox = pgTable(
  'inbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    rawText: text('raw_text').notNull(),
    source: text('source').notNull(),
    status: inboxStatus('status').notNull().default('pending'),
    /** null = Claude hasn't processed it yet */
    draft: jsonb('draft').$type<Draft>(),
    /**
     * The category chosen at capture time. **Nullable** — the iOS Shortcut path doesn't send
     * one, and the review page falls back to the default category when it sees null.
     *
     * `onDelete: 'set null'` rather than `restrict`: having a pending item block deleting a
     * category would be too surprising (a word must belong somewhere; a piece of raw text
     * that hasn't been reviewed yet need not).
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
     * Review queues are split by category.
     *
     * `onDelete: 'restrict'` is **deliberate**: a category holding words can't be deleted;
     * move the words out first. The application layer checks the count and gives a friendly
     * message, but this database-level guard has to exist too — when the code has a bug,
     * words must not disappear silently along with their category.
     */
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    /**
     * Confusables: words close enough in spelling or sound to get mixed up
     * (cursory / cursor / courtesy).
     *
     * Attached to the word rather than the encounter, because being confusable is a property
     * of the word itself; every encounter of the same word should share one set.
     *
     * Two sources: typed by hand, or the AI match that asks Claude for look-alikes and
     * sound-alikes (`POST /api/words/{id}/contrasts/suggest`). The two are **merged, never
     * overwritten** — a manual entry is something he got wrong himself and wrote down, and
     * the model's suggestions must not wash it away.
     */
    contrasts: jsonb('contrasts').$type<string[]>().notNull().default([]),
    /**
     * A hand-written note. **Human only; the AI never touches it** — like confusables, this is
     * something only he knows: why this word is hard to remember, where he saw it, how his
     * boss used it in an email.
     *
     * Attached to the word rather than the encounter: a note annotates "this word", and every
     * encounter of it should share the note. Nullable — never written and written empty are
     * the same thing.
     *
     * Named remark rather than note because `encounters.note` already means "definition", and
     * two `note`s meaning two different things in one repository will eventually be misread.
     */
    remark: text('remark'),
    /**
     * For manual ordering. Backfilled alphabetically by lemma, so without dragging anything it
     * looks exactly as it did before. A newly confirmed word takes its category's `max+1` and
     * lands at the end (the default of 0 would put it first, which is wrong).
     */
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Word frequency (Zipf, see `src/lib/frequency.ts`). **Nullable** — null means "not listed
     * in SUBTLEX" (phrases, proper nouns), which is not the same as "frequency zero".
     */
    zipf: real('zipf'),
    /**
     * Marked Know during this Quick pass round, therefore out of the queue. Reset to false in
     * bulk when a round ends.
     *
     * **Entirely unrelated** to the review progress in `cards` — Quick pass is a triage sweep
     * through a whole category in frequency order, cloze review is spaced repetition; the two
     * run independently and never write each other's fields.
     */
    triageDone: boolean('triage_done').notNull().default(false),
    /**
     * Position in this Quick pass round's queue. **null = not in any round**.
     *
     * Starting a round stamps 1, 2, 3… in frequency order (same ordering as
     * `/api/words/reorder-by-frequency`). A "Don't know" slots the word between the 10th and
     * 11th ahead — which is why this is double precision rather than integer: there has to be
     * room between two consecutive values.
     *
     * It does not reuse `sortOrder`: that is the order dragged out by hand, whereas this
     * queue gets shuffled repeatedly by "Don't know". Sharing one column would destroy the
     * words page's ordering the moment you left this mode.
     */
    triageOrder: doublePrecision('triage_order'),
    createdAt: createdAt(),
  },
  (t) => [
    index('words_lemma_idx').on(t.lemma),
    /*
     * "One word row per lemma per category" used to live only in a comment, enforced by the
     * application's check-then-insert — under concurrency two requests both see "doesn't
     * exist" and each insert a row. Bulk confirm matches `RETURNING` results back by lemma
     * inside one transaction, and that only holds if the uniqueness is **guaranteed by the
     * database**.
     */
    uniqueIndex('words_lemma_category_idx').on(t.lemma, t.categoryId),
  ],
);

/** One word, many encounters. */
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
     * Part of speech, judged from **this particular context** (`n.` / `v.` / `a.` …).
     *
     * At the same level as `note`, and like it, it follows the context — `tear` is n. (the
     * one you cry) in one sentence and v. (to rip) in another. A dictionary isn't used because
     * a dictionary lists every sense: 57% of the 221 words have two or more parts of speech,
     * so pasting them all in makes over half of it noise. Claude can see the sentence and
     * knows which one is in play.
     */
    pos: text('pos'),
    createdAt: createdAt(),
  },
  (t) => [index('encounters_word_id_idx').on(t.wordId)],
);

/** A review card. cloze = the original sentence with a blank, not "English → Chinese".
 *  ease/interval/reps are SM-2 state. */
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
    /** Interval in days */
    interval: integer('interval').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    // The review queue queries by due; this index is on the hot path
    index('cards_due_idx').on(t.due),
    index('cards_encounter_id_idx').on(t.encounterId),
  ],
);

/**
 * Claude API usage records, one row per call.
 *
 * Every SDK response carries `usage`, which used to be thrown away. Stored, it lets `/usage`
 * break spend down by purpose and by day at **zero extra cost and with no new API key**.
 *
 * Why not aggregate by day: the row count is tiny (a few dozen a day at most), and keeping the
 * detail is what makes the per-purpose split possible — and adding a dimension later won't
 * require rewriting history.
 *
 * 🔴 **Amounts are not stored** — prices change, and a hardcoded "this is what it cost" is
 * false precision. Related: Anthropic has **no** balance endpoint (the Admin API exposes usage
 * and spend only, and isn't open to personal accounts), so "what's left" is Console-only.
 */
export const apiUsage = pgTable(
  'api_usage',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** What it was for: process (drafting) / contrast (AI-matched confusables) */
    purpose: text('purpose').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Cache-hit input tokens — priced far below ordinary input, so recording them separately
     *  is what makes the effect of caching visible */
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('api_usage_created_at_idx').on(t.createdAt)],
);

/**
 * Global settings. A KV table, currently holding `model.process`, `model.contrast` (which
 * model each AI path uses, chosen on `/usage`, see `src/lib/models.ts`) and, once edited,
 * `prompt.process` / `prompt.contrast`.
 *
 * KV rather than a column per purpose: adding a third AI path, or later syncing some of the
 * UI toggles across devices, then needs no schema change.
 *
 * 🔴 **Migrations insert no default rows**; the defaults live in code as a fallback. That way
 * a fresh environment, or one where migrations didn't all run, still can't take the AI calls
 * down over a missing setting — one setting should never be able to break the main flow.
 */
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
