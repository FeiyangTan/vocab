import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, isValidSession } from '@/lib/auth';

/**
 * Next 16 里 `middleware.ts` 已废弃改名为 `proxy.ts`，导出函数名必须是 `proxy`。
 * 默认跑 Node.js runtime，且不能设 runtime 配置。
 */

/** 不需要登录态的路径。/api/inbox 走 token 校验（在路由里做），不走 cookie。 */
const PUBLIC_PATHS = ['/login', '/api/login', '/api/inbox'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
