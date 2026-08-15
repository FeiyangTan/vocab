import { inArray, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';

/**
 * 重排。`PUT /api/words/reorder` body `{ ids: number[] }` —— 当前列表的新次序。
 *
 * 🔴 **只重排传进来的这批，列表外的词一个都不动。**
 *
 * `sort_order` 是一条全局序列，但界面上看到的常常是筛选后的子集（在 `videos`
 * 的 35 个里拖动，不该影响另外 187 个）。做法是**只在这批词自己的值域里洗牌**：
 * 把它们现有的 sort_order 取出来升序排好，再按新次序重新分配这些值。
 * 值的集合没变，所以这批词和列表外任何一个词的相对位置都保持原样。
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((v): v is number => typeof v === 'number' && Number.isInteger(v))
    : null;
  if (!ids || ids.length === 0 || ids.length !== new Set(ids).size) {
    return NextResponse.json({ error: 'ids must be an array of unique integers' }, { status: 400 });
  }

  try {
    const updated = await getDb().transaction(async (tx) => {
      const rows = await tx
        .select({ id: words.id, sortOrder: words.sortOrder })
        .from(words)
        .where(inArray(words.id, ids));
      if (rows.length !== ids.length) throw new Error('MISSING');

      // 这批词现有的位置，升序 —— 待会儿按新次序发回去
      const slots = rows.map((r) => r.sortOrder).sort((a, b) => a - b);
      const pairs = ids.map((id, i) => ({ id, sortOrder: slots[i] }));

      await tx.execute(sql`
        UPDATE ${words} AS w
        SET sort_order = v.sort_order
        FROM (VALUES ${sql.join(
          pairs.map((p) => sql`(${p.id}::bigint, ${p.sortOrder}::int)`),
          sql`, `,
        )}) AS v(id, sort_order)
        WHERE w.id = v.id
      `);

      return pairs.length;
    });

    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'MISSING') {
      return NextResponse.json({ error: 'Some ids do not exist' }, { status: 404 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
