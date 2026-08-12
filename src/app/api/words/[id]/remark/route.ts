import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { words } from '@/db/schema';
import { cleanRemark } from '@/lib/remark';

/**
 * 设置一个词的备注。`PUT /api/words/{id}/remark` body `{ remark: string | null }`
 *
 * 和对比词那个接口一样是**整体替换**、幂等：词汇页和复习页共用一个，
 * 前端把改完的整段传回来即可。
 *
 * 传 null 或空串 = 清空备注（这是**有意**的语义，不是漏判）——
 * 界面上清空输入框保存就该把备注删掉。
 */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { remark?: unknown } | null;
  if (!body || !('remark' in body)) {
    return NextResponse.json({ error: '缺少 remark' }, { status: 400 });
  }
  const remark = cleanRemark(body.remark);

  const updated = await getDb()
    .update(words)
    .set({ remark })
    .where(eq(words.id, id))
    .returning({ id: words.id });

  if (updated.length === 0) {
    return NextResponse.json({ error: '词不存在' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, remark });
}
