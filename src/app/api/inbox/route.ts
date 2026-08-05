import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';
import { isValidInboxToken } from '@/lib/auth';

/**
 * 捕获落点。
 *
 * token 放 query 而非 header —— iOS 快捷指令加 header 麻烦。
 * 这条路由在 proxy.ts 的 PUBLIC_PATHS 里，走 token 不走 cookie。
 *
 * 只做一次 INSERT，原文照存：不做词形还原、不去重、不判断 domain、不挖空。
 * 那些都是 Phase 4 的事 —— 捕获阶段任何加工都是在给 3 秒预算加负担。
 */

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('t');
  if (!isValidInboxToken(token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let rawText: string;
  let source = 'unknown';
  try {
    const body = (await request.json()) as { raw_text?: unknown; source?: unknown };
    if (typeof body.raw_text !== 'string' || body.raw_text.trim().length === 0) {
      return NextResponse.json({ error: 'raw_text 不能为空' }, { status: 400 });
    }
    rawText = body.raw_text;
    if (typeof body.source === 'string' && body.source.length > 0) source = body.source;
  } catch {
    return NextResponse.json({ error: 'body 必须是 JSON' }, { status: 400 });
  }

  try {
    const [row] = await getDb()
      .insert(inbox)
      .values({ rawText, source })
      .returning({ id: inbox.id });
    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
