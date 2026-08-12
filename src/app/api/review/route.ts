import { and, asc, eq, lte, sql, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { contrastHintsFor } from '@/lib/dictionary';

/**
 * 取下一张到期的卡。`GET /api/review?category=<id|all>`
 *
 * 每次只返回一张 —— iOS 上 PWA 后台会被系统清掉，所以进度必须每答一张就写回服务端，
 * 不能一次拉一整队列放在内存里慢慢消。
 *
 * `all` 只是**放宽取卡范围**（不按分类过滤），排序、评分、排程一个字都没改 ——
 * 到期早的先来，本来就是全局口径。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const scope = parseScope(new URL(request.url).searchParams.get('category'));
  if (scope === null) {
    return NextResponse.json({ error: "category 必须是分类 id 或 'all'" }, { status: 400 });
  }

  const db = getDb();

  // 分类可能刚被删掉 —— 不查的话下面两个查询都返回空，前端会显示成「复习完了」
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
      // 前端要 wordId 才能调 PUT /api/words/{id}/contrasts 就地添加对比词
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

  // 对比词的中文在服务端查好一起返回 —— 前端不碰那张 2.18MB 的表
  return NextResponse.json({
    card: card ?? null,
    remaining,
    glosses: card ? contrastHintsFor(card.contrasts) : {},
  });
}
