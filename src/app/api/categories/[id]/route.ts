import { and, eq, ne, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories, words } from '@/db/schema';
import { cleanCategoryName, parseCategoryId } from '@/lib/categories';

/**
 * Rename / set default / delete.
 *
 * `PATCH /api/categories/{id}`  body: `{ name?: string; isDefault?: true }`
 * `DELETE /api/categories/{id}?moveTo=<id>`
 *
 * Deletion policy: a category holding words **is not deleted**; `moveTo` must be supplied to
 * relocate them. The database's `onDelete: 'restrict'` is the second line of the same rule —
 * the check here exists to produce a comprehensible error, but what actually prevents data
 * loss is the foreign key.
 */
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseCategoryId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    isDefault?: unknown;
  } | null;
  if (!body) return NextResponse.json({ error: 'Empty request' }, { status: 400 });

  const db = getDb();

  const [target] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (!target) return NextResponse.json({ error: 'Category not found' }, { status: 404 });

  if (body.name !== undefined) {
    const name = cleanCategoryName(body.name);
    if (!name) return NextResponse.json({ error: 'Category name cannot be empty' }, { status: 400 });

    const [dup] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, name), ne(categories.id, id)))
      .limit(1);
    if (dup) {
      return NextResponse.json({ error: `A category named ${name} already exists` }, { status: 409 });
    }

    await db.update(categories).set({ name }).where(eq(categories.id, id));
  }

  if (body.isDefault === true) {
    // "Exactly one default" can't be expressed as a database constraint, so a transaction
    // carries it: set every row false, then set this one true
    await db.transaction(async (tx) => {
      await tx.update(categories).set({ isDefault: false }).where(ne(categories.id, id));
      await tx.update(categories).set({ isDefault: true }).where(eq(categories.id, id));
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = parseCategoryId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const moveTo = parseCategoryId(new URL(request.url).searchParams.get('moveTo'));
  if (moveTo === id) {
    return NextResponse.json({ error: 'Cannot move into itself' }, { status: 400 });
  }

  const db = getDb();

  try {
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: categories.id, isDefault: categories.isDefault })
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1);
      if (!target) throw new Error('NOT_FOUND');

      // Every word must belong somewhere, so the last category can't be deleted
      const [{ total }] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(categories);
      if (total <= 1) throw new Error('LAST_ONE');

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(words)
        .where(eq(words.categoryId, id));

      if (count > 0) {
        if (!moveTo) throw new Error('HAS_WORDS');
        const [dest] = await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.id, moveTo))
          .limit(1);
        if (!dest) throw new Error('BAD_MOVE_TO');
        await tx.update(words).set({ categoryId: moveTo }).where(eq(words.categoryId, id));
      }

      await tx.delete(categories).where(eq(categories.id, id));

      // The default was just deleted, so the flag needs a new home — otherwise the review
      // page has nothing to preselect
      if (target.isDefault) {
        const [next] = await tx
          .select({ id: categories.id })
          .from(categories)
          .orderBy(categories.sortOrder, categories.id)
          .limit(1);
        if (next) {
          await tx.update(categories).set({ isDefault: true }).where(eq(categories.id, next.id));
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
    if (message === 'LAST_ONE') {
      return NextResponse.json({ error: 'You must keep at least one category' }, { status: 409 });
    }
    if (message === 'HAS_WORDS') {
      return NextResponse.json({ error: 'This category still has words — pick where to move them first' }, { status: 409 });
    }
    if (message === 'BAD_MOVE_TO') {
      return NextResponse.json({ error: 'Move target not found' }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
