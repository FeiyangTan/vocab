import { sql, type SQL } from 'drizzle-orm';
import type { Scope } from './categories';

/**
 * Queue rules for Quick pass. See the word → Know / Don't know / Delete; a round ends when
 * everything in scope has been cleared.
 *
 * The queue **lives on the server** (`words.triage_order` / `words.triage_done`) and the
 * frontend takes one word at a time — same reasoning as cloze review (see the comment in
 * `src/app/api/review/route.ts`: on iOS the system reaps a backgrounded PWA, so progress
 * can't be held in memory). "Refresh doesn't lose progress" comes free with it: the frontend
 * has no queue to lose.
 *
 * The scope may be one category or `'all'`. **Round state is shared** — a word marked Know
 * inside videos won't reappear under "All" either. "Known this round" is a property of the
 * **word**, not of which door you came in through.
 *
 * 🔴 **None of this touches `cards`.** Quick pass is a triage sweep through a batch of words
 * in frequency order; cloze review is spaced repetition. Each writes its own fields.
 */

/** How many places a "Don't know" moves the word back */
export const PUSH_BACK = 10;

/** The scope's WHERE fragment. `'all'` is a tautology, so the SQL composes without ifs */
function within(scope: Scope): SQL {
  return scope === 'all' ? sql`true` : sql`category_id = ${scope}`;
}

/**
 * What a queue position means: a **global frequency rank**.
 *
 * 🔴 The rank is computed over **all words**, not within the scope — this is what makes "All"
 * work at all. If each category numbered itself 1..N, combining four categories would bunch
 * four #1s at the front and the result wouldn't be frequency order. As a global rank the
 * number is comparable anywhere:
 * - combined → `ORDER BY triage_order` is global frequency order
 * - narrowed to one category → a subset of the global ranks, whose relative order is still
 *   that category's frequency order (the ranks go sparse, but nothing depends on them
 *   being contiguous)
 *
 * The ordering matches `POST /api/words/reorder-by-frequency` exactly (common first, words
 * SUBTLEX doesn't list sort last as null, ties broken stably by alphabetical order).
 */
const globalRank = sql`
  SELECT id, row_number() OVER (ORDER BY zipf DESC NULLS LAST, lemma) AS rn FROM words
`;

/**
 * Stamp a rank on every in-scope word that **has no position yet**, pulling it into the
 * current round.
 *
 * Called before each fetch (`GET /api/triage` skips the SQL when the count comes back 0).
 * It does two things:
 * 1. On first entry, it queues the whole batch — so there is no "Start" button to press
 * 2. Mid-round, words newly confirmed from the inbox join the queue in place — jimmy adds
 *    words constantly, and making them wait for the next round makes no sense
 *
 * **Leaves `triage_done` alone** — a word already marked Know must not be dragged back into
 * the queue; that's what "New round" is for.
 */
export function stampUnqueued(scope: Scope) {
  return sql`
    UPDATE words AS w SET triage_order = v.rn
    FROM (${globalRank}) AS v
    WHERE w.id = v.id AND w.triage_order IS NULL AND ${within(scope)}
  `;
}

/**
 * "New round": re-rank everything in scope and clear the Know flags.
 *
 * So **a round forgets completely when it ends** — a word you knew last round comes up again
 * next round. This mode is "sweep through a batch of words", not long-term memory scheduling
 * (that's cloze review's job).
 *
 * 🔴 **Scoped**: hitting "New round" from inside a category resets only that category. One
 * tap in videos must not wipe the 132-word progress in 《Hocus and Pocus》.
 */
export function resetRound(scope: Scope) {
  return sql`
    UPDATE words AS w SET triage_order = v.rn, triage_done = false
    FROM (${globalRank}) AS v
    WHERE w.id = v.id AND ${within(scope)}
  `;
}

/**
 * Mark "Don't know": move back `PUSH_BACK` places in the queue.
 *
 * This cannot be written as `triage_order += 10` — that adds in the **value space**, which is
 * not the same as "how many places back" (repeated insertions leave the values full of gaps
 * and fractions). What's actually needed is to find the 10th and 11th words ahead and slot in
 * between them, which is why `triage_order` is double precision.
 *
 * "The 10th ahead" is counted **within the scope**: across categories in All mode, within the
 * one category otherwise. Both are correct — each matches the queue that was on screen.
 *
 * Three cases, handled by the COALESCE chain:
 * 1. ≥10 words ahead — slot between the 10th and 11th (with no 11th, it's the 10th + 1)
 * 2. fewer than 10 ahead — go last (jimmy's rule)
 * 3. nothing ahead at all — **stay put**. That follows directly from the rules: "Don't know"
 *    never leaves the queue, so pressing it on the last remaining word shows the same word
 *    again. The UI says so plainly rather than pretending it moved.
 */
export function pushBack(scope: Scope, wordId: number) {
  return sql`
    WITH q AS (
      SELECT triage_order AS o, row_number() OVER (ORDER BY triage_order) AS rn
      FROM words
      WHERE ${within(scope)}
        AND NOT triage_done
        AND triage_order IS NOT NULL
        AND triage_order > (SELECT triage_order FROM words WHERE id = ${wordId})
    )
    UPDATE words SET triage_order = COALESCE(
      (SELECT CASE WHEN n.o IS NULL THEN t.o + 1 ELSE (t.o + n.o) / 2 END
         FROM q t LEFT JOIN q n ON n.rn = ${PUSH_BACK + 1}
        WHERE t.rn = ${PUSH_BACK}),
      (SELECT max(o) + 1 FROM q),
      triage_order
    )
    WHERE id = ${wordId}
  `;
}
