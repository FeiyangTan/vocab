import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { contrastHintsFor } from '@/lib/dictionary';
import { phoneticOf } from '@/lib/phonetics';
import { stampUnqueued } from '@/lib/triage';

/**
 * Quick pass: fetch the next word. `GET /api/triage?category=<id|all>`
 *
 * Like `/api/review`, one word per request — the queue lives on the server and the frontend
 * never holds it. Before fetching, any in-scope word without a position is stamped into the
 * queue (see `stampUnqueued`), so the first visit just works with no "Start" button, and
 * words confirmed mid-round join the queue automatically.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const scope = parseScope(new URL(request.url).searchParams.get('category'));
  if (scope === null) {
    return NextResponse.json({ error: "category must be a category id or 'all'" }, { status: 400 });
  }

  const db = getDb();

  // The category may have just been deleted — without this check everything below returns
  // empty and the frontend renders it as "round finished"
  if (scope !== 'all') {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, scope))
      .limit(1);
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
  }

  const inScope: SQL | undefined = scope === 'all' ? undefined : eq(words.categoryId, scope);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // How many have no position yet: the UPDATE below only fires when this is > 0, which
      // in the steady state it isn't — so no extra cost
      unqueued: sql<number>`count(*) FILTER (WHERE ${words.triageOrder} IS NULL)::int`,
    })
    .from(words)
    .where(inScope);

  if (counts.unqueued > 0) {
    await db.execute(stampUnqueued(scope));
  }

  const inQueue = and(inScope, isNotNull(words.triageOrder), eq(words.triageDone, false));

  const [word] = await db
    .select({
      id: words.id,
      lemma: words.lemma,
      remark: words.remark,
      contrasts: words.contrasts,
      zipf: words.zipf,
      // The category name: in All scope this is the only thing that shows where a word
      // came from
      category: categories.name,
    })
    .from(words)
    .innerJoin(categories, eq(categories.id, words.categoryId))
    .where(inQueue)
    .orderBy(asc(words.triageOrder))
    .limit(1);

  /*
   * "Details" has to show **exactly** what the words page shows when expanded, so this fetches
   * per encounter too (the same word has different definitions in different contexts, each
   * with its own original sentence), matching what `/words` does.
   *
   * `clozeText` isn't here for review — it's used to locate **the span that was blanked out**
   * inside the original sentence. Words are often inflected there (guard → guarded), so
   * matching on the lemma doesn't find them.
   */
  const detail = word
    ? await db
        .select({
          id: encounters.id,
          rawText: encounters.rawText,
          note: encounters.note,
          pos: encounters.pos,
          clozeText: cards.clozeText,
        })
        .from(encounters)
        .innerJoin(cards, eq(cards.encounterId, encounters.id))
        .where(eq(encounters.wordId, word.id))
        .orderBy(asc(encounters.createdAt))
    : [];

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(words)
    .where(inQueue);

  return NextResponse.json({
    // Phonetics and confusable glosses are both resolved server-side — those two tables
    // (0.95MB / 2.18MB) never reach the browser
    word: word ? { ...word, phonetic: phoneticOf(word.lemma), encounters: detail } : null,
    glosses: word ? contrastHintsFor(word.contrasts) : {},
    remaining,
    total: counts.total,
    /** Queue empty but the scope still has words = this round is finished (as distinct from
     *  "this scope has no words at all") */
    roundOver: !word && counts.total > 0,
  });
}
