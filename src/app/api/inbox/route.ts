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
 * 原文照存：不做词形还原、不去重、不判断 domain、不挖空。
 * 那些都是整理阶段的事 —— 捕获阶段任何加工都是在给 3 秒预算加负担。
 *
 * 唯一的例外是 `split: true` 时按行拆成多条，**只有网页输入框会传这个字段**。
 * 快捷指令不传 → iOS 那条链路的行为一个字节都不变（分享网页时 iOS 传过来的是
 * 「页面文案 + 换行 + URL」，拆开会每次多出一条只有 URL 的垃圾条目）。
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
  let split = false;
  try {
    const body = (await request.json()) as {
      raw_text?: unknown;
      source?: unknown;
      split?: unknown;
    };
    if (typeof body.raw_text !== 'string' || body.raw_text.trim().length === 0) {
      return NextResponse.json({ error: 'raw_text 不能为空' }, { status: 400 });
    }
    rawText = body.raw_text;
    if (typeof body.source === 'string' && body.source.length > 0) source = body.source;
    split = body.split === true;
  } catch {
    return NextResponse.json({ error: 'body 必须是 JSON' }, { status: 400 });
  }

  // 拆行：逐行 trim、丢掉空行。
  // 不拆：只去首尾空白 —— 中间的换行要留着，那正是「整段当一条」的意义
  //（PDF 复制的折行、iOS 分享的「文案 + 换行 + URL」都靠它保持完整）。
  const texts = split
    ? rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    : [rawText.trim()];

  if (texts.length === 0) {
    return NextResponse.json({ error: 'raw_text 不能为空' }, { status: 400 });
  }

  try {
    const rows = await getDb()
      .insert(inbox)
      .values(texts.map((t) => ({ rawText: t, source })))
      .returning({ id: inbox.id });
    return NextResponse.json({ ids: rows.map((r) => r.id), count: rows.length }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
