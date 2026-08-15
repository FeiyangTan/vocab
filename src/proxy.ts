import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { COOKIE_NAME, isValidSession } from '@/lib/auth';

/**
 * In Next 16, `middleware.ts` is deprecated and renamed to `proxy.ts`, and the exported
 * function must be called `proxy`. It runs on the Node.js runtime by default, and the runtime
 * cannot be configured.
 */

/**
 * Paths that need no session. /api/inbox authenticates by token (checked inside the route),
 * not by cookie.
 *
 * ⚠️ **Exact match, not prefix match.** With a prefix, `/api/inbox` would also let through
 * `/api/inbox/process` and `/api/inbox/{id}/confirm` — both of which require login.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/api/login',
  '/api/inbox',
  // PWA icons: as routes they have no file extension, so they don't hit the image exclusion
  // in the matcher below. Without these, iOS "Add to Home Screen" fetches the icon and gets
  // redirected to the login page
  '/icon',
  '/apple-icon',
  // Vercel Cron can't carry a login cookie; this route checks Bearer $CRON_SECRET itself
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

  // API requests get a 401, never a redirect to the login page — otherwise the caller
  // receives a blob of HTML
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
  // Exclude static assets, or CSS/JS/images get blocked along with everything else
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)',
  ],
};
