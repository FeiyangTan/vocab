import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { parseCategoryId } from '@/lib/categories';

/**
 * Reorder by frequency. `POST /api/words/reorder-by-frequency` body `{ categoryId?: number }`
 *
 * 🔴 **Applies to the whole scope, not the current page.**
 *
 * This used to be done in the frontend: sort the list by zipf, then send the ids to
 * `PUT /api/words/reorder`. Once pagination arrived the frontend only held the current
 * page's 30, so only those 30 got sorted — while "reorder by frequency" obviously means the
 * whole category returns to frequency order. Hence it moved to the server, done in one SQL
 * statement.
 *
 * The ordering matches `scripts/backfill-zipf.mjs`: common first, words not in the corpus
 * (null) last, ties broken stably by alphabetical order.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { categoryId?: unknown } | null;

  // No categoryId = everything; with one, only that category is reordered
  let categoryId: number | null = null;
  if (body?.categoryId !== undefined && body.categoryId !== null) {
    categoryId = parseCategoryId(body.categoryId);
    if (!categoryId) {
      return NextResponse.json({ error: 'categoryId must be a category id' }, { status: 400 });
    }
  }

  const scope = categoryId
    ? sql`WHERE category_id = ${categoryId}`
    : sql``;

  const result = await getDb().execute(sql`
    UPDATE words AS w
    SET sort_order = v.rn
    FROM (
      SELECT id, row_number() OVER (ORDER BY zipf DESC NULLS LAST, lemma) AS rn
      FROM words
      ${scope}
    ) AS v
    WHERE w.id = v.id
  `);

  return NextResponse.json({ ok: true, updated: result.rowCount ?? 0 });
}
