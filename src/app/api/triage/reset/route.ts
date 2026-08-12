import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { resetRound } from '@/lib/triage';

/**
 * 「再来一轮」。`POST /api/triage/reset` body `{ categoryId: <id|'all'> }`
 *
 * 把范围内的「认识」清掉、位置按词频序重打 —— 所以一轮结束就忘干净，
 * 上一轮认识的词下一轮照样出现。这个模式是「把一批词过一遍」，
 * 不是长期记忆调度（那是挖空复习的活）。
 *
 * 🔴 **按范围生效**：从某个分类点只重置那个分类，不会把别的分类的进度冲掉。
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { categoryId?: unknown } | null;
  const scope = parseScope(body?.categoryId);
  if (scope === null) {
    return NextResponse.json({ error: "categoryId 必须是分类 id 或 'all'" }, { status: 400 });
  }

  const db = getDb();
  if (scope !== 'all') {
    const [category] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, scope))
      .limit(1);
    if (!category) {
      return NextResponse.json({ error: '分类不存在' }, { status: 404 });
    }
  }

  const result = await db.execute(resetRound(scope));
  return NextResponse.json({ ok: true, queued: result.rowCount ?? 0 });
}
