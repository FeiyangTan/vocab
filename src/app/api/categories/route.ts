import { eq, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { listCategories } from '@/db/queries';
import { categories } from '@/db/schema';
import { cleanCategoryName } from '@/lib/categories';

/**
 * Create and list categories. `GET /api/categories` / `POST /api/categories`
 *
 * The list carries each category's word count — deletion needs it to decide between
 * "safe to delete" and "move the words first".
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ categories: await listCategories() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = cleanCategoryName(body?.name);
  if (!name) {
    return NextResponse.json({ error: 'Category name cannot be empty' }, { status: 400 });
  }

  const db = getDb();

  // Duplicate names have no unique constraint at the database level (names are editable, and
  // a constraint would force the rename path to handle conflicts too), so one check here is
  // enough — single-user app, there's no concurrent create-same-name scenario.
  const [dup] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.name, name))
    .limit(1);
  if (dup) {
    return NextResponse.json({ error: `A category named ${name} already exists` }, { status: 409 });
  }

  // Goes last. sortOrder is currently determined by creation order alone; no drag-to-reorder
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${categories.sortOrder}), -1)::int` })
    .from(categories);

  // With no categories at all, the one being created becomes the default — otherwise the
  // review page has nothing to preselect
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(categories);

  const [created] = await db
    .insert(categories)
    .values({ name, sortOrder: max + 1, isDefault: count === 0 })
    .returning({ id: categories.id, name: categories.name, isDefault: categories.isDefault });

  return NextResponse.json({ category: { ...created, wordCount: 0 } }, { status: 201 });
}
