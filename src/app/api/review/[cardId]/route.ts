import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { cards } from '@/db/schema';
import { sm2 } from '@/lib/sm2';

/** 提交评分。`POST /api/review/{cardId}` body `{ grade: 0-3 }` → SM-2 更新 due/ease/interval。 */
export async function POST(request: Request, ctx: { params: Promise<{ cardId: string }> }) {
  const cardId = Number((await ctx.params).cardId);
  if (!Number.isInteger(cardId)) {
    return NextResponse.json({ error: 'bad cardId' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { grade?: unknown } | null;
  const grade = typeof body?.grade === 'number' ? body.grade : NaN;
  if (!Number.isInteger(grade) || grade < 0 || grade > 3) {
    return NextResponse.json({ error: 'grade 必须是 0–3 的整数' }, { status: 400 });
  }

  const db = getDb();

  const [card] = await db
    .select({ ease: cards.ease, interval: cards.interval, reps: cards.reps })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);

  if (!card) return NextResponse.json({ error: '卡片不存在' }, { status: 404 });

  const next = sm2(card, grade);

  await db
    .update(cards)
    .set({ ease: next.ease, interval: next.interval, reps: next.reps, due: next.due })
    .where(eq(cards.id, cardId));

  return NextResponse.json({
    ok: true,
    interval: next.interval,
    ease: Number(next.ease.toFixed(2)),
    reps: next.reps,
    due: next.due.toISOString(),
  });
}
