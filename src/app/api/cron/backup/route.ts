import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/auth';
import { createSnapshot } from '@/lib/neon-branch';

/**
 * 每周备份。由 Vercel Cron 触发（见 vercel.json）。
 *
 * Cron 请求带不了登录 cookie，所以这条路由在 proxy 的 PUBLIC_PATHS 里，
 * 自己校验 Vercel 注入的 `Authorization: Bearer $CRON_SECRET`。
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET 未配置' }, { status: 500 });
  }

  const auth = request.headers.get('authorization') ?? '';
  if (!safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await createSnapshot();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 502 });
  }
}
