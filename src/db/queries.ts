import { asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { categories, words } from '@/db/schema';

/**
 * 分类列表 + 每个分类的词数。
 *
 * **服务端专用**（导入了 db client，别在 client component 里 import）。
 * 放在这里而不是路由文件里：Next 会严格校验 route 的导出，路由文件只能导出
 * HTTP 方法和配置。这个查询被 `GET /api/categories` 和四个页面共用，
 * 抽出来是为了删除时「能不能直接删」的口径只有一处。
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
