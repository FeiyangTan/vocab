import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { parseCategoryId } from '@/lib/categories';

/**
 * 取下一张到期的卡。`GET /api/review?category=<id>`
 *
 * 每次只返回一张 —— iOS 上 PWA 后台会被系统清掉，所以进度必须每答一张就写回服务端，
 * 不能一次拉一整队列放在内存里慢慢消。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const categoryId = parseCategoryId(new URL(request.url).searchParams.get('category'));
  if (!categoryId) {
    return NextResponse.json({ error: 'category 必须是分类 id' }, { status: 400 });
  }

  const db = getDb();

  // 分类可能刚被删掉 —— 不查的话下面两个查询都返回空，前端会显示成「复习完了」
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (!category) {
    return NextResponse.json({ error: '分类不存在' }, { status: 404 });
  }

  const now = new Date();

  const [card] = await db
    .select({
      id: cards.id,
      clozeText: cards.clozeText,
      lemma: words.lemma,
      note: encounters.note,
      rawText: encounters.rawText,
      // 前端要 wordId 才能调 PUT /api/words/{id}/contrasts 就地添加对比词
      wordId: words.id,
      contrasts: words.contrasts,
    })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(and(eq(words.categoryId, categoryId), lte(cards.due, now)))
    .orderBy(asc(cards.due))
    .limit(1);

  const [{ count: remaining }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(and(eq(words.categoryId, categoryId), lte(cards.due, now)));

  return NextResponse.json({ card: card ?? null, remaining });
}
