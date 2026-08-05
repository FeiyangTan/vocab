import { NextResponse } from 'next/server';
import { COOKIE_NAME, COOKIE_MAX_AGE, safeEqual, sessionToken } from '@/lib/auth';

export async function POST(request: Request) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: 'APP_PASSWORD 未配置' }, { status: 500 });
  }

  let password = '';
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body.password === 'string') password = body.password;
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  if (!safeEqual(password, expected)) {
    return NextResponse.json({ error: '密码不对' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return response;
}
