import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, isValidSession } from '@/lib/auth';

/**
 * Next 16 里 `middleware.ts` 已废弃改名为 `proxy.ts`，导出函数名必须是 `proxy`。
 * 默认跑 Node.js runtime，且不能设 runtime 配置。
 */

/**
 * 不需要登录态的路径。/api/inbox 走 token 校验（在路由里做），不走 cookie。
 *
 * ⚠️ **精确匹配，不是前缀匹配。** 用前缀的话 `/api/inbox` 会连带放行
 * `/api/inbox/process` 和 `/api/inbox/{id}/confirm` —— 那两个是要登录的。
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/api/login',
  '/api/inbox',
  // PWA 图标：路由形式没有文件后缀，落不进下面 matcher 的图片排除规则，
  // 不放行的话 iOS「添加到主屏」抓图标会被重定向到登录页
  '/icon',
  '/apple-icon',
  // Vercel Cron 带不了登录 cookie，这条路由自己校验 Bearer $CRON_SECRET
  '/api/cron/backup',
]);

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  if (await isValidSession(request.cookies.get(COOKIE_NAME)?.value)) {
    return NextResponse.next();
  }

  // API 请求返回 401，不要重定向到登录页 —— 否则调用方拿到的是一坨 HTML
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // 排除静态资源，否则 CSS/JS/图片会被一起挡掉
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)',
  ],
};
