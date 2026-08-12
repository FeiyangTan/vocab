import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { parseCategoryId } from '@/lib/categories';

/**
 * 按词频重排。`POST /api/words/reorder-by-frequency` body `{ categoryId?: number }`
 *
 * 🔴 **作用于整个范围，不是当前页。**
 *
 * 原来这件事是前端做的：把列表按 zipf 排好再把 ids 发给 `PUT /api/words/reorder`。
 * 分页之后前端手里只有当前页那 30 个，那样只会排这 30 个 —— 而「按词频重排」
 * 的意思显然是整个分类回到词频序。所以挪到服务端，一条 SQL 排完。
 *
 * 排序口径和 `scripts/backfill-zipf.mjs` 一致：常见的在前，未收录的（null）
 * 排最后，同分按字母序保持稳定。
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { categoryId?: unknown } | null;

  // 不传 categoryId = 全部；传了就只排那个分类
  let categoryId: number | null = null;
  if (body?.categoryId !== undefined && body.categoryId !== null) {
    categoryId = parseCategoryId(body.categoryId);
    if (!categoryId) {
      return NextResponse.json({ error: 'categoryId 必须是分类 id' }, { status: 400 });
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
