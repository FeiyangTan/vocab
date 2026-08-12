import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { categories, encounters, words } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { phoneticOf } from '@/lib/phonetics';
import { stampUnqueued } from '@/lib/triage';

/**
 * 「快速过词」取下一个词。`GET /api/triage?category=<id|all>`
 *
 * 和 `/api/review` 一样每次只返回一个 —— 队列在服务端，前端不持有它。
 * 取词前先把范围内还没排过位置的词排进队列（见 `stampUnqueued`），
 * 所以第一次进来直接能用、不用先按「开始」，轮进行中新确认的词也会自动入队。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const scope = parseScope(new URL(request.url).searchParams.get('category'));
  if (scope === null) {
    return NextResponse.json({ error: "category 必须是分类 id 或 'all'" }, { status: 400 });
  }

  const db = getDb();

  // 分类可能刚被删掉 —— 不查的话下面全返回空，前端会显示成「过完了」
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

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      // 还没排过位置的：>0 才需要发那条 UPDATE，常态下是 0，零额外开销
      unqueued: sql<number>`count(*) FILTER (WHERE ${words.triageOrder} IS NULL)::int`,
    })
    .from(words)
    .where(inScope);

  if (counts.unqueued > 0) {
    await db.execute(stampUnqueued(scope));
  }

  const inQueue = and(inScope, isNotNull(words.triageOrder), eq(words.triageDone, false));

  const [word] = await db
    .select({
      id: words.id,
      lemma: words.lemma,
      remark: words.remark,
      // 释义挂在 encounter 上，取最近那次 —— 口径同词汇页
      note: sql<string | null>`
        (array_agg(${encounters.note} ORDER BY ${encounters.createdAt} DESC)
         FILTER (WHERE ${encounters.note} IS NOT NULL))[1]
      `,
      pos: sql<string | null>`
        (array_agg(${encounters.pos} ORDER BY ${encounters.createdAt} DESC)
         FILTER (WHERE ${encounters.note} IS NOT NULL))[1]
      `,
    })
    .from(words)
    .leftJoin(encounters, eq(encounters.wordId, words.id))
    .where(inQueue)
    .groupBy(words.id)
    .orderBy(asc(words.triageOrder))
    .limit(1);

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(words)
    .where(inQueue);

  return NextResponse.json({
    // 音标在服务端查好 —— 那张 0.95MB 的表不进浏览器（同对比词中文的规矩）
    word: word ? { ...word, phonetic: phoneticOf(word.lemma) } : null,
    remaining,
    total: counts.total,
    /** 队列空了但范围内还有词 = 这一轮过完了（区别于「这个范围根本没有词」） */
    roundOver: !word && counts.total > 0,
  });
}
