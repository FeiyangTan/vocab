/**
 * 单用户单密码认证。
 *
 * 设计取舍：只有我（jimmy）一个人用，不需要用户表、session 表、过期刷新。
 * cookie 里放的是 HMAC(AUTH_SECRET, 固定串)，服务端每次重算一遍比对 ——
 * 拿不到 AUTH_SECRET 就伪造不出来，这对单用户场景足够了。
 */

export const COOKIE_NAME = 'vocab_auth';

/** cookie 有效期一年。iOS 上 PWA 是独立进程，登录态不与 Safari 共享，过期要重输密码很烦。 */
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const SESSION_PAYLOAD = 'vocab-session-v1';

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET 未配置');
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

/** 定长比较，避免按字符提前返回泄漏信息。 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 登录成功后种进 cookie 的值。 */
export function sessionToken(): Promise<string> {
  return hmacHex(requireSecret(), SESSION_PAYLOAD);
}

/** 校验请求里带来的 cookie 值。 */
export async function isValidSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  return safeEqual(value, await sessionToken());
}

/** 校验 /api/inbox?t=... 的 token。捕获接口走 token，不走 cookie。 */
export function isValidInboxToken(value: string | null): boolean {
  const expected = process.env.INBOX_TOKEN;
  if (!expected) throw new Error('INBOX_TOKEN 未配置');
  if (!value) return false;
  return safeEqual(value, expected);
}
