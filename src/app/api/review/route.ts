import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards, encounters, words } from '@/db/schema';

/**
 * 取下一张到期的卡。`GET /api/review?domain=work|daily`
 *
 * 每次只返回一张 —— iOS 上 PWA 后台会被系统清掉，所以进度必须每答一张就写回服务端，
 * 不能一次拉一整队列放在内存里慢慢消。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const domain = new URL(request.url).searchParams.get('domain');
  if (domain !== 'work' && domain !== 'daily') {
    return NextResponse.json({ error: 'domain 必须是 work 或 daily' }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();

  const [card] = await db
    .select({
      id: cards.id,
      clozeText: cards.clozeText,
      lemma: words.lemma,
      note: encounters.note,
      rawText: encounters.rawText,
    })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(and(eq(words.domain, domain), lte(cards.due, now)))
    .orderBy(asc(cards.due))
    .limit(1);

  const [{ count: remaining }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(cards)
    .innerJoin(encounters, eq(cards.encounterId, encounters.id))
    .innerJoin(words, eq(encounters.wordId, words.id))
    .where(and(eq(words.domain, domain), lte(cards.due, now)));

  return NextResponse.json({ card: card ?? null, remaining });
}
