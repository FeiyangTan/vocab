import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories, words } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';
import { zipfOf } from '@/lib/frequency';

/**
 * Delete a word. `DELETE /api/words/{id}`
 *
 * 🔴 **Takes all of its encounters and review cards with it** — the foreign keys on
 * `encounters.word_id` and `cards.encounter_id` are both `onDelete: cascade`, so one DELETE
 * suffices. It also means the word's original sentences, definitions and review progress are
 * all gone, with **no undo**. That's why the UI asks for two taps.
 */
export const dynamic = 'force-dynamic';

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const deleted = await getDb()
    .delete(words)
    .where(eq(words.id, id))
    .returning({ id: words.id, lemma: words.lemma });

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, lemma: deleted[0].lemma });
}

/**
 * drizzle wraps the raw pg error, so the error code lives on the `cause` chain and **not in
 * the string** — testing with `String(error).includes('23505')` never matches (and the case
 * escapes as a 500).
 */
function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: string }).code === '23505') return true;
  }
  return false;
}

/**
 * Edit a word or move it to another category.
 * `PATCH /api/words/{id}` body `{ lemma?: string; categoryId?: number }`
 *
 * 🔴 When the destination category already has a word of the same name, this **returns 409
 * and does not merge**. Merging would mean deciding which definition to keep, which original
 * sentences, and which card's review progress — a lossy operation, and doing it silently is
 * the worst version. There's a live example in the database: `sneak` exists in two
 * categories at once.
 *
 * It lands at the **end** of the new category (its current max+1), rather than guessing where
 * it should be inserted.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    lemma?: unknown;
    categoryId?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Empty request' }, { status: 400 });

  const db = getDb();

  const [word] = await db
    .select({ lemma: words.lemma, categoryId: words.categoryId })
    .from(words)
    .where(eq(words.id, id))
    .limit(1);
  if (!word) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }

  // ---- rename ----
  if (body.lemma !== undefined) {
    const lemma = typeof body.lemma === 'string' ? body.lemma.trim().slice(0, 80) : '';
    if (!lemma) {
      return NextResponse.json({ error: 'Word cannot be empty' }, { status: 400 });
    }
    try {
      // Frequency follows the rename — without recomputing, the new word would carry the old
      // word's zipf and both the ordering and the band indicator would be wrong
      await db
        .update(words)
        .set({ lemma, zipf: zipfOf(lemma) })
        .where(eq(words.id, id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        return NextResponse.json(
          { error: `This category already has ${lemma}` },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
    return NextResponse.json({ ok: true, lemma, zipf: zipfOf(lemma) });
  }

  // ---- move to another category ----
  const categoryId = parseCategoryId(body.categoryId);
  if (!categoryId) {
    return NextResponse.json({ error: 'categoryId must be a category id' }, { status: 400 });
  }

  const [category] = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 400 });
  }

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${words.sortOrder}), 0)::int` })
    .from(words)
    .where(eq(words.categoryId, categoryId));

  try {
    await db
      .update(words)
      .set({ categoryId, sortOrder: max + 1 })
      .where(eq(words.id, id));
  } catch (error) {
    // 23505 = unique_violation, hitting the (lemma, category_id) unique index
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: `${category.name} already has ${word.lemma}` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, categoryId });
}
