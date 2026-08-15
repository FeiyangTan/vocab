import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, categories, encounters, words } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { contrastHintsFor } from '@/lib/dictionary';
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
    return NextResponse.json({ error: "category must be a category id or 'all'" }, { status: 400 });
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
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
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
      contrasts: words.contrasts,
      zipf: words.zipf,
      // 分类名：在「全部」范围里过词时，这是唯一能看出这个词从哪儿来的信息
      category: categories.name,
    })
    .from(words)
    .innerJoin(categories, eq(categories.id, words.categoryId))
    .where(inQueue)
    .orderBy(asc(words.triageOrder))
    .limit(1);

  /*
   * 「看详情」要展示的和词汇页展开后的**完全一样**，所以这里也按 encounter 逐条取
   *（同一个词在不同语境下释义不同，各带各的原句），口径和 `/words` 那边一致。
   *
   * `clozeText` 不是拿来复习的 —— 是用来在原句里定位**当初挖掉的那一段**，
   * 词在句子里常常是变形的（guard → guarded），拿 lemma 匹配找不到。
   */
  const detail = word
    ? await db
        .select({
          id: encounters.id,
          rawText: encounters.rawText,
          note: encounters.note,
          pos: encounters.pos,
          clozeText: cards.clozeText,
        })
        .from(encounters)
        .innerJoin(cards, eq(cards.encounterId, encounters.id))
        .where(eq(encounters.wordId, word.id))
        .orderBy(asc(encounters.createdAt))
    : [];

  const [{ remaining }] = await db
    .select({ remaining: sql<number>`count(*)::int` })
    .from(words)
    .where(inQueue);

  return NextResponse.json({
    // 音标和对比词的中文都在服务端查好 —— 那两张表（0.95MB / 2.18MB）不进浏览器
    word: word ? { ...word, phonetic: phoneticOf(word.lemma), encounters: detail } : null,
    glosses: word ? contrastHintsFor(word.contrasts) : {},
    remaining,
    total: counts.total,
    /** 队列空了但范围内还有词 = 这一轮过完了（区别于「这个范围根本没有词」） */
    roundOver: !word && counts.total > 0,
  });
}
