import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { categories, words } from '@/db/schema';

/**
 * The category list plus each category's word count.
 *
 * **Server-only** (it imports the db client; never import it from a client component).
 * It lives here rather than in a route file because Next validates route exports strictly —
 * a route file may only export HTTP methods and config. This query is shared by
 * `GET /api/categories` and four pages; extracting it keeps "is this safe to delete" defined
 * in exactly one place.
 */
export async function listCategories() {
  return getDb()
    .select({
      id: categories.id,
      name: categories.name,
      isDefault: categories.isDefault,
      wordCount: sql<number>`count(${words.id})::int`,
    })
    .from(categories)
    .leftJoin(words, eq(words.categoryId, categories.id))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.id));
}

export type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number];
