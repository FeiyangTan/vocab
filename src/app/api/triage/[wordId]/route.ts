import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';
import { parseScope } from '@/lib/categories';
import { pushBack } from '@/lib/triage';

/**
 * 「快速过词」记一个判断。
 * `POST /api/triage/{wordId}` body `{ action: 'known' | 'unknown', scope: <id|'all'> }`
 *
 * - `known` → 本轮出队
 * - `unknown` → 在队列里退后 10 位（规则见 `src/lib/triage.ts`）
 *
 * `scope` 是**当时屏幕上那个队列**的范围，`unknown` 要用它数「后面第 10 个」——
 * 在「全部」里退 10 位和在一个分类里退 10 位落点不一样，两个都对。
 *
 * **「删除」不在这儿** —— 直接用已有的 `DELETE /api/words/{id}`，
 * 它已经级联删掉 encounters 和复习卡了，没必要再造一个入口。
 *
 * 🔴 两个动作都**不碰 `cards`**：快速过词不改复习计划。
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: { params: Promise<{ wordId: string }> }) {
  const id = Number((await ctx.params).wordId);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    scope?: unknown;
  } | null;

  const action = body?.action;
  if (action !== 'known' && action !== 'unknown') {
    return NextResponse.json({ error: "action must be 'known' or 'unknown'" }, { status: 400 });
  }

  const db = getDb();

  const [word] = await db
    .select({ categoryId: words.categoryId, triageOrder: words.triageOrder })
    .from(words)
    .where(eq(words.id, id))
    .limit(1);
  if (!word) {
    return NextResponse.json({ error: 'Word not found' }, { status: 404 });
  }

  if (action === 'known') {
    await db.update(words).set({ triageDone: true }).where(eq(words.id, id));
    return NextResponse.json({ ok: true });
  }

  // 没传 scope 就退回这个词自己的分类 —— 比拿 'all' 兜底安全：
  // 猜大了会跨分类数出一个和屏幕上不一致的落点
  const scope = parseScope(body?.scope) ?? word.categoryId;
  // 没排过位置说明它还没进队列（正常路径下 GET 已经排过了），排位置是 GET 的活
  if (word.triageOrder === null) {
    return NextResponse.json({ error: 'This word is not in the queue yet' }, { status: 409 });
  }
  await db.execute(pushBack(scope, id));
  return NextResponse.json({ ok: true });
}
