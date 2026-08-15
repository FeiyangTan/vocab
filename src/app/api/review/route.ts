import { and, asc, eq, lte, sql, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { contrastHintsFor } from '@/lib/dictionary';

/**
 * Fetch the next due card. `GET /api/review?category=<id|all>`
 *
 * One card per request — on iOS the system reaps a backgrounded PWA, so progress has to be
 * written back to the server after every answer; pulling a whole queue into memory and
 * working through it is not an option.
 *
 * `all` only **widens which cards are eligible** (no category filter); ordering, grading and
 * scheduling are untouched — due-first was already a global ordering.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const scope = parseScope(new URL(request.url).searchParams.get('category'));
  if (scope === null) {
    return NextResponse.json({ error: "category must be a category id or 'all'" }, { status: 400 });
  }

  const db = getDb();

  // The category may have just been deleted — without this check both queries below return
  // empty and the frontend renders it as "review finished"
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
  const now = new Date();

  const [card] = await db
    .select({
      id: cards.id,
      clozeText: cards.clozeText,
      lemma: words.lemma,
      note: encounters.note,
      pos: encounters.pos,
      rawText: encounters.rawText,
      // The frontend needs wordId to call PUT /api/words/{id}/contrasts and add a
      // confusable in place
      wordId: words.id,
      contrasts: words.contrasts,
      remark: words.remark,
    })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(and(inScope, lte(cards.due, now)))
    .orderBy(asc(cards.due))
    .limit(1);

  const [{ count: remaining }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(and(inScope, lte(cards.due, now)));

  // Confusable glosses are looked up server-side and returned alongside — the frontend never
  // touches that 2.18MB table
  return NextResponse.json({
    card: card ?? null,
    remaining,
    glosses: card ? contrastHintsFor(card.contrasts) : {},
  });
}
