import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { encounters } from '@/db/schema';

/**
 * 改一条 encounter 的释义。`PUT /api/encounters/{id}/note` body `{ note: string | null }`
 *
 * 释义挂在 **encounter** 不挂在 word —— 同一个词在不同语境下意思可以不一样
 *（brew：`泡；煮（茶、咖啡）` vs `泡（茶）；煮（咖啡）`），所以改的是「这一次遇到」
 * 的释义，不影响同一个词的其它 encounter。
 *
 * 和对比词、备注那两个接口一样是整体替换、幂等。
 */
export const dynamic = 'force-dynamic';

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
  if (!body || !('note' in body)) {
    return NextResponse.json({ error: 'Missing note' }, { status: 400 });
  }
  const raw = typeof body.note === 'string' ? body.note.trim() : '';
  const note = raw || null;

  const updated = await getDb()
    .update(encounters)
    .set({ note })
    .where(eq(encounters.id, id))
    .returning({ id: encounters.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, note });
}
