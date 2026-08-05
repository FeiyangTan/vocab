import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inbox } from '@/db/schema';
import { COOKIE_NAME, isValidInboxToken, isValidSession } from '@/lib/auth';

/**
 * 捕获落点。**两种身份都收**：
 *
 * - `?t=<token>` —— 给 iOS 快捷指令用。token 放 query 而非 header，因为快捷指令加 header 麻烦。
 * - 登录 cookie —— 给网页端手动添加用，这样前端不必把 token 塞进 JS。
 *
 * 这条路由在 proxy.ts 的 PUBLIC_PATHS 里（proxy 不拦），所以两种校验都得在这里自己做。
 *
 * 只做一次 INSERT，原文照存：不做词形还原、不去重、不判断 domain、不挖空。
 * 那些都是整理阶段的事 —— 捕获阶段任何加工都是在给 3 秒预算加负担。
 */

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get('t');
  const authorized =
    isValidInboxToken(token) ||
    (await isValidSession((await cookies()).get(COOKIE_NAME)?.value));

  if (!authorized) {
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
