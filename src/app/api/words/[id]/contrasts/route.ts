import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';

/**
 * 设置一个词的对比词。`PUT /api/words/{id}/contrasts` body `{ contrasts: string[] }`
 *
 * **整组替换**而不是增量 add/remove —— 幂等，复习页和词汇页共用同一个接口，
 * 前端拿当前数组改完整个传回来即可，不用维护两套逻辑。
 */

/** 手滑粘一大段进来的防线，不是产品功能 */
const MAX = 8;

function clean(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const word = item.trim();
    if (word && !seen.has(word)) seen.add(word);
    if (seen.size >= MAX) break;
  }
  return [...seen];
}

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { contrasts?: unknown } | null;
  const contrasts = clean(body?.contrasts);
  if (!contrasts) {
    return NextResponse.json({ error: 'contrasts 必须是字符串数组' }, { status: 400 });
  }

  const updated = await getDb()
    .update(words)
    .set({ contrasts })
    .where(eq(words.id, id))
    .returning({ id: words.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: '词不存在' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, contrasts });
}
