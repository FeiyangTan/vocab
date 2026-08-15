/**
 * Single-user, single-password auth.
 *
 * The trade-off: jimmy is the only user, so there is no need for a users table, a sessions
 * table, or expiry/refresh. The cookie holds HMAC(AUTH_SECRET, fixed string), and the server
 * recomputes and compares it on every request — without AUTH_SECRET you can't forge one,
 * which is enough for a single-user app.
 */

export const COOKIE_NAME = 'vocab_auth';

/** Cookie lasts a year. On iOS a PWA is its own process and doesn't share login state with
 *  Safari, so an expiry means retyping the password — annoying enough to avoid. */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const SESSION_PAYLOAD = 'vocab-session-v1';

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  return secret;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Constant-time compare, so an early per-character return can't leak information. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The value written into the cookie on successful login. */
export function sessionToken(): Promise<string> {
  return hmacHex(requireSecret(), SESSION_PAYLOAD);
}

/** Validate the cookie value carried by a request. */
export async function isValidSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  return safeEqual(value, await sessionToken());
}

/** Validate the token on /api/inbox?t=... The capture endpoint uses a token, not the cookie. */
export function isValidInboxToken(value: string | null): boolean {
  const expected = process.env.INBOX_TOKEN;
  if (!expected) throw new Error('INBOX_TOKEN is not configured');
  if (!value) return false;
  return safeEqual(value, expected);
}
